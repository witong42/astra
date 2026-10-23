import Foundation
import AVFoundation
import Speech
import NaturalLanguage

let silenceDelay: TimeInterval = 1.05
let recognitionRotation: TimeInterval = 48
let microphoneBufferFrames: AVAudioFrameCount = 1024
let preRollDuration: TimeInterval = 2.5
let maximumRecognitionFailures = 3
func emit(_ value: [String: Any]) {
    do { FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: value) + Data([10])) }
    catch { FileHandle.standardError.write(Data("Astra could not encode a voice event.\n".utf8)) }
}
func event(_ method: String, _ params: [String: Any] = [:]) { emit(["method": method, "params": params]) }
func normalized(_ text: String) -> String {
    text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
        .components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(separator: " ")
}
final class RecognitionLane {
    let language: String
    let request = SFSpeechAudioBufferRecognitionRequest()
    var task: SFSpeechRecognitionTask?
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
    private var requests: [SFSpeechAudioBufferRecognitionRequest] = []
    private var preRoll: [AVAudioPCMBuffer] = []
    private var recognizers: [String: SFSpeechRecognizer] = [:]
    private var lanes: [RecognitionLane] = []
    private var cycle = UUID()
    private var enabled = false
    private var wakeOnly = false
    private var tapInstalled = false
    private var silence: DispatchWorkItem?
    private var rotation: DispatchWorkItem?
    private var spokenText = ""
    private var utteranceIds: [ObjectIdentifier: Int] = [:]
    private var lastLevel: TimeInterval = 0
    private var failures = 0
    private var lastPartial = ""
    override init() { super.init(); synthesizer.delegate = self }
    func start(id: Any, standby: Bool) {
        AVCaptureDevice.requestAccess(for: .audio) { allowed in
            guard allowed else { self.failure(id, "Enable Microphone for Astra in System Settings > Privacy & Security."); return }
            SFSpeechRecognizer.requestAuthorization { authorization in
                DispatchQueue.main.async {
                    guard authorization == .authorized else { self.failure(id, "Enable Speech Recognition for Astra in System Settings > Privacy & Security."); return }
                    do {
                        try self.beginListening(standby: standby)
                        emit(["id": id, "result": ["locales": ["en-GB", "fr-FR"], "onDevice": true]])
                    } catch { self.stop(); self.failure(id, error.localizedDescription) }
                }
            }
        }
    }
    private func failure(_ id: Any, _ text: String) { emit(["id": id, "error": ["code": -32000, "message": text]]) }
    private func beginListening(standby: Bool) throws {
        guard !enabled else { return }
        for (language, locale) in [("en", "en-GB"), ("fr", "fr-FR")] {
            guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)), recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
                throw NSError(domain: "AstraVoice", code: 1, userInfo: [NSLocalizedDescriptionKey: "Enable \(locale) dictation in System Settings > Keyboard > Dictation to download its on-device speech support, then retry Astra."])
            }
            recognizers[language] = recognizer
        }
        let input = engine.inputNode
        try input.setVoiceProcessingEnabled(true)
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw NSError(domain: "AstraVoice", code: 2, userInfo: [NSLocalizedDescriptionKey: "No microphone input is available."])
        }
        enabled = true
        wakeOnly = standby
        startRecognition()
        input.installTap(onBus: 0, bufferSize: microphoneBufferFrames, format: format) { buffer, _ in
            self.requestLock.lock()
            for request in self.requests { request.append(buffer) }
            if let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength), let from = buffer.floatChannelData, let to = copy.floatChannelData {
                copy.frameLength = buffer.frameLength
                for channel in 0..<Int(buffer.format.channelCount) { to[channel].update(from: from[channel], count: Int(buffer.frameLength)) }
                self.preRoll.append(copy)
                var frames = self.preRoll.reduce(0) { $0 + Int($1.frameLength) }
                while frames > Int(format.sampleRate * preRollDuration), self.preRoll.count > 1 { frames -= Int(self.preRoll.removeFirst().frameLength) }
            }
            self.requestLock.unlock()
            let now = Date.timeIntervalSinceReferenceDate
            if now - self.lastLevel > 0.1, let samples = buffer.floatChannelData?[0] {
                self.lastLevel = now
                let count = Int(buffer.frameLength)
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
    private func startRecognition(preRoll includePreRoll: Bool = false) {
        guard enabled else { return }
        silence?.cancel(); rotation?.cancel()
        cycle = UUID()
        let current = cycle
        for lane in lanes { lane.task?.cancel() }
        lanes = (wakeOnly ? ["en"] : ["en", "fr"]).map { RecognitionLane($0) }
        lastPartial = ""
        requestLock.lock()
        for request in requests { request.endAudio() }
        requests = lanes.map { $0.request }
        let buffered = includePreRoll ? preRoll : []
        if !includePreRoll { preRoll.removeAll(keepingCapacity: true) }
        requestLock.unlock()
        for lane in lanes {
            let request = lane.request
            request.requiresOnDeviceRecognition = true
            request.shouldReportPartialResults = true
            request.addsPunctuation = true
            request.contextualStrings = ["Astra"]
            request.taskHint = .dictation
            for buffer in buffered { request.append(buffer) }
            lane.task = recognizers[lane.language]?.recognitionTask(with: request) { result, error in
                DispatchQueue.main.async {
                    guard self.enabled, self.cycle == current else { return }
                    if let result {
                        self.failures = 0
                        lane.text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
                        let segments = result.bestTranscription.segments
                        lane.confidence = segments.isEmpty ? 0 : segments.reduce(0) { $0 + $1.confidence } / Float(segments.count)
                        self.received(lane, final: result.isFinal)
                    } else if let error {
                        let native = error as NSError
                        if native.code == 1110 || native.code == 203 || native.code == 216 { self.startRecognition(); return }
                        self.failures += 1
                        if self.failures < maximumRecognitionFailures {
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { if self.cycle == current { self.startRecognition() } }
                        } else { event("voice/error", ["message": "Speech recognition stopped: " + error.localizedDescription]); self.stop() }
                    }
                }
            }
        }
        let rotate = DispatchWorkItem { if self.wakeOnly || self.bestText().0.isEmpty { self.startRecognition() } else { self.finishUtterance() } }
        rotation = rotate
        DispatchQueue.main.asyncAfter(deadline: .now() + recognitionRotation, execute: rotate)
    }
    private func received(_ lane: RecognitionLane, final: Bool) {
        let plain = normalized(lane.text)
        guard !plain.isEmpty else { if final { startRecognition() }; return }
        if wakeOnly {
            if plain.split(separator: " ").contains("astra") {
                wakeOnly = false
                event("voice/wake")
                startRecognition(preRoll: true)
            } else if final { startRecognition() }
            return
        }
        if synthesizer.isSpeaking && normalized(spokenText).contains(plain) { return }
        let (text, language) = bestText()
        guard !text.isEmpty, text != lastPartial else { return }
        if synthesizer.isSpeaking { interrupt() }
        lastPartial = text
        event("voice/partial", ["text": text, "language": language])
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
        if !text.isEmpty { event("voice/final", ["text": text, "language": language]) }
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
        silence?.cancel(); rotation?.cancel()
        cycle = UUID()
        for lane in lanes { lane.task?.cancel() }
        lanes = []
        requestLock.lock()
        for request in requests { request.endAudio() }
        requests = []; preRoll = []
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
let voice = VoiceEngine()
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        guard let data = line.data(using: .utf8), let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let id = message["id"], let method = message["method"] as? String else { continue }
        let params = message["params"] as? [String: Any] ?? [:]
        DispatchQueue.main.async {
            switch method {
            case "start": voice.start(id: id, standby: params["standby"] as? Bool ?? false)
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
