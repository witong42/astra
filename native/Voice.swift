import Foundation
@preconcurrency import AVFoundation
import Speech
import NaturalLanguage

let silenceDelay: TimeInterval = 1.05
let recognitionRotation: TimeInterval = 48
let microphoneBufferFrames: AVAudioFrameCount = 1024
let preRollDuration: TimeInterval = 2.5
func emit(_ value: [String: Any]) {
    do { FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: value) + Data([10])) }
    catch { FileHandle.standardError.write(Data("Astra could not encode a voice event.\n".utf8)) }
}
func event(_ method: String, _ params: [String: Any] = [:]) { emit(["method": method, "params": params]) }
func normalized(_ text: String) -> String {
    text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
        .components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(separator: " ")
}
func isHomeShortcut(_ text: String) -> Bool {
    let words = normalized(text).split(separator: " ")
    return !words.isEmpty && words.allSatisfy { $0 == "home" }
}
final class HomeShortcutRecognition {
    private var silence: DispatchWorkItem?
    private var observed: [String: String] = [:]
    private let onHome: () -> Void
    private let onReset: () -> Void
    private let onRecognition: (String, String) -> Void
    init(onHome: @escaping () -> Void, onReset: @escaping () -> Void, onRecognition: @escaping (String, String) -> Void = { _, _ in }) {
        self.onHome = onHome; self.onReset = onReset; self.onRecognition = onRecognition
    }
    func received(language: String, text: String) {
        if observed[language] != text {
            observed[language] = text
            onRecognition(language, text)
        }
        guard language == "en", !normalized(text).isEmpty else { return }
        silence?.cancel()
        let finish = DispatchWorkItem { [onHome, onReset] in
            if isHomeShortcut(text) { onHome() }
            onReset()
        }
        silence = finish
        DispatchQueue.main.asyncAfter(deadline: .now() + silenceDelay, execute: finish)
    }
    func cancel() { silence?.cancel(); silence = nil; observed.removeAll() }
}
final class RecognitionLane {
    let language: String
    var text = ""
    var confidence: Float = 0
    init(_ language: String) { self.language = language }
    var score: Float {
        let detector = NLLanguageRecognizer()
        detector.processString(text)
        let detected = detector.dominantLanguage?.rawValue
        return confidence + (detected == language ? 0.3 : 0) + (text.count > 3 ? 0.05 : 0)
    }
}
final class VoiceEngine: NSObject, AVSpeechSynthesizerDelegate, @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let synthesizer = AVSpeechSynthesizer()
    private let requestLock = NSLock()
    private var recognition: SpeechRecognition?
    private var preRoll: [AVAudioPCMBuffer] = []
    private var lanes: [RecognitionLane] = []
    private var cycle = UUID()
    private var enabled = false
    private var wakeOnly = false
    private var homeOnly = false
    private var tapInstalled = false
    private var silence: DispatchWorkItem?
    private var rotation: DispatchWorkItem?
    private var spokenText = ""
    private var utteranceIds: [ObjectIdentifier: Int] = [:]
    private var lastLevel: TimeInterval = 0
    private var lastPartial = ""
    private lazy var homeShortcut = HomeShortcutRecognition(onHome: { event("voice/home") }, onReset: { [weak self] in
        event("voice/shortcut", ["language": "en", "text": ""])
        self?.startRecognition()
    }, onRecognition: { language, text in
        event("voice/shortcut", ["language": language, "text": String(text.prefix(160))])
    })
    override init() { super.init(); synthesizer.delegate = self }
    func start(id: Any, standby: Bool, homeOnly: Bool = false) {
        AVCaptureDevice.requestAccess(for: .audio) { allowed in
            guard allowed else { self.failure(id, "Enable Microphone for Astra in System Settings > Privacy & Security."); return }
            Task { @MainActor in
                do {
                    try await self.beginListening(standby: standby, homeOnly: homeOnly)
                    emit(["id": id, "result": ["locales": ["en-GB", "fr-FR"], "onDevice": true]])
                } catch { self.stop(); self.failure(id, error.localizedDescription) }
            }
        }
    }
    private func failure(_ id: Any, _ text: String) { emit(["id": id, "error": ["code": -32000, "message": text]]) }
    private func beginListening(standby: Bool, homeOnly: Bool) async throws {
        guard !enabled else { return }
        let input = engine.inputNode
        try input.setVoiceProcessingEnabled(true)
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw NSError(domain: "AstraVoice", code: 2, userInfo: [NSLocalizedDescriptionKey: "No microphone input is available."])
        }
        enabled = true
        wakeOnly = standby
        self.homeOnly = homeOnly
        try await prepareRecognition()
        input.installTap(onBus: 0, bufferSize: microphoneBufferFrames, format: format) { buffer, _ in
            guard let mono = monoMicrophoneBuffer(buffer) else { return }
            self.requestLock.lock()
            if let recognition = self.recognition { recognition.append(mono) }
            else {
                self.preRoll.append(mono)
                var frames = self.preRoll.reduce(0) { $0 + Int($1.frameLength) }
                while frames > Int(format.sampleRate * preRollDuration), self.preRoll.count > 1 { frames -= Int(self.preRoll.removeFirst().frameLength) }
            }
            self.requestLock.unlock()
            let now = Date.timeIntervalSinceReferenceDate
            if now - self.lastLevel > 0.1, let samples = mono.floatChannelData?[0] {
                self.lastLevel = now
                let count = Int(mono.frameLength)
                var energy: Float = 0
                for i in 0..<count { energy += samples[i] * samples[i] }
                let level = min(1, sqrt(energy / Float(max(1, count))) * 8)
                DispatchQueue.main.async { if self.enabled { event("voice/level", ["level": level]) } }
            }
        }
        tapInstalled = true
        engine.prepare()
        try engine.start()
    }
    func listen() { guard enabled else { return }; if wakeOnly { wakeOnly = false; startRecognition() } }
    func standby() { guard enabled else { return }; interrupt(); wakeOnly = true; startRecognition() }
    private func startRecognition() {
        Task { @MainActor in
            do { try await self.prepareRecognition() }
            catch { if self.enabled { event("voice/error", ["message": error.localizedDescription]); self.stop() } }
        }
    }
    private func prepareRecognition() async throws {
        guard enabled else { return }
        homeShortcut.cancel()
        silence?.cancel(); rotation?.cancel()
        cycle = UUID()
        let current = cycle
        requestLock.withLock { recognition?.stop(); recognition = nil; preRoll = [] }
        lanes = recognitionLanguages.map { RecognitionLane($0.0) }
        lastPartial = ""
        guard let monoFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: engine.inputNode.outputFormat(forBus: 0).sampleRate, channels: 1, interleaved: false) else { return }
        let prepared = try await SpeechRecognition.prepare(inputFormat: monoFormat, onResult: { language, text, confidence in
            guard self.enabled, self.cycle == current, let lane = self.lanes.first(where: { $0.language == language }) else { return }
            lane.text = text; lane.confidence = confidence
            self.received(lane, final: false)
        }, onError: { error in
            guard self.enabled, self.cycle == current else { return }
            event("voice/error", ["message": "Speech recognition stopped: " + error.localizedDescription]); self.stop()
        })
        guard enabled, cycle == current else { prepared.stop(); return }
        requestLock.withLock {
            for buffer in preRoll { prepared.append(buffer) }
            preRoll = []; recognition = prepared
        }
        let rotate = DispatchWorkItem { if self.wakeOnly || self.bestText().0.isEmpty { self.startRecognition() } else { self.finishUtterance() } }
        rotation = rotate
        DispatchQueue.main.asyncAfter(deadline: .now() + recognitionRotation, execute: rotate)
    }
    private func received(_ lane: RecognitionLane, final: Bool) {
        let plain = normalized(lane.text)
        guard !plain.isEmpty else { if final { startRecognition() }; return }
        if wakeOnly {
            silence?.cancel()
            homeShortcut.received(language: lane.language, text: lane.text)
            if homeOnly { return }
            if isHomeShortcut(plain) { return }
            if plain.split(separator: " ").contains("astra") {
                homeShortcut.cancel()
                wakeOnly = false
                event("voice/wake")
                lastPartial = ""
            } else { return }
        }
        if synthesizer.isSpeaking && normalized(spokenText).contains(plain) { return }
        let (text, language) = bestText()
        guard text != lastPartial || text.isEmpty else { return }
        if synthesizer.isSpeaking { interrupt() }
        lastPartial = text
        if !text.isEmpty { event("voice/partial", ["text": text, "language": language]) }
        silence?.cancel()
        let finish = DispatchWorkItem { self.finishUtterance() }
        silence = finish
        DispatchQueue.main.asyncAfter(deadline: .now() + silenceDelay, execute: finish)
    }
    private func bestText() -> (String, String) {
        guard let lane = lanes.filter({ !$0.text.isEmpty }).max(by: { $0.score < $1.score }) else { return ("", "en") }
        let text = lane.text.replacingOccurrences(of: "^\\s*[Aa]stra\\b[ ,.!?:;]*", with: "", options: .regularExpression)
        return (text, lane.language)
    }
    private func finishUtterance() {
        guard enabled, !wakeOnly else { return }
        let (text, language) = bestText()
        startRecognition()
        event("voice/final", ["text": text, "language": language])
    }
    func speak(_ text: String, id: Int, language: String) {
        interrupt()
        wakeOnly = false
        startRecognition()
        spokenText = text
        let utterance = AVSpeechUtterance(string: text)
        let detector = NLLanguageRecognizer(); detector.processString(text)
        let locale = detector.dominantLanguage == .french ? "fr-FR" : detector.dominantLanguage == .english ? "en-GB" : language == "fr" ? "fr-FR" : "en-GB"
        utterance.voice = AVSpeechSynthesisVoice(language: locale)
        utterance.rate = 0.49
        utteranceIds[ObjectIdentifier(utterance)] = id
        synthesizer.speak(utterance)
    }
    func interrupt() { synthesizer.stopSpeaking(at: .immediate); spokenText = "" }
    func stop() {
        enabled = false
        homeShortcut.cancel()
        silence?.cancel(); rotation?.cancel()
        cycle = UUID()
        lanes = []
        requestLock.lock()
        recognition?.stop(); recognition = nil; preRoll = []
        requestLock.unlock()
        if engine.isRunning { engine.stop() }
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        interrupt()
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        if let id = utteranceIds[ObjectIdentifier(utterance)] { event("voice/speaking", ["speechId": id]) }
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) { completeSpeech(utterance, reset: true) }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) { completeSpeech(utterance, reset: false) }
    private func completeSpeech(_ utterance: AVSpeechUtterance, reset: Bool) {
        if let id = utteranceIds.removeValue(forKey: ObjectIdentifier(utterance)) { event("voice/finished", ["speechId": id]) }
        if !synthesizer.isSpeaking { spokenText = ""; if reset { startRecognition() } }
    }
}
#if !ASTRA_SPEECH_TEST
@main
struct AstraVoice {
static func main() {
let voice = VoiceEngine()
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        guard let data = line.data(using: .utf8), let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let id = message["id"], let method = message["method"] as? String else { continue }
        let params = message["params"] as? [String: Any] ?? [:]
        DispatchQueue.main.async {
            switch method {
            case "start": voice.start(id: id, standby: params["standby"] as? Bool ?? false, homeOnly: params["homeOnly"] as? Bool ?? false)
            case "listen": voice.listen(); emit(["id": id, "result": [:]])
            case "standby": voice.standby(); emit(["id": id, "result": [:]])
            case "speak":
                guard let text = params["text"] as? String, !text.isEmpty, text.count <= 4000, let speechId = params["speechId"] as? Int else { emit(["id": id, "error": ["code": -32602, "message": "Invalid speech request"]]); return }
                voice.speak(text, id: speechId, language: params["language"] as? String ?? "en")
                emit(["id": id, "result": [:]])
            case "interrupt": voice.interrupt(); emit(["id": id, "result": [:]])
            case "stop": voice.stop(); emit(["id": id, "result": [:]])
            default: emit(["id": id, "error": ["code": -32601, "message": "Unknown voice command"]])
            }
        }
    }
    DispatchQueue.main.async { voice.stop(); exit(0) }
}
RunLoop.main.run()
}
}
#endif
