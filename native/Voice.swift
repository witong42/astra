import Foundation
@preconcurrency import AVFoundation

let microphoneBufferFrames: AVAudioFrameCount = 1024
private let outputQueue = DispatchQueue(label: "astra.microphone.output")
func emit(_ value: [String: Any]) {
    outputQueue.sync {
        do { FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: value) + Data([10])) }
        catch { FileHandle.standardError.write(Data("Astra could not encode a microphone event.\n".utf8)) }
    }
}
func event(_ method: String, _ params: [String: Any] = [:]) { emit(["method": method, "params": params]) }
func configureVoiceInput(_ input: AVAudioInputNode) throws {
    try input.setVoiceProcessingEnabled(true)
    input.voiceProcessingOtherAudioDuckingConfiguration = .init(enableAdvancedDucking: false, duckingLevel: .min)
}
func monoMicrophoneBuffer(_ input: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    guard let source = input.floatChannelData?[0],
          let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: input.format.sampleRate, channels: 1, interleaved: false),
          let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: input.frameLength),
          let destination = output.floatChannelData?[0] else { return nil }
    output.frameLength = input.frameLength
    destination.update(from: source, count: Int(input.frameLength))
    return output
}
final class VoiceEngine: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private var tapInstalled = false
    private var generation = UUID()
    func start(id: Any) {
        let current = generation
        AVCaptureDevice.requestAccess(for: .audio) { allowed in
            DispatchQueue.main.async {
                guard self.generation == current else { return }
                guard allowed else {
                    emit(["id": id, "error": ["code": -32000, "message": "Enable Microphone for Astra in System Settings > Privacy & Security."]]); return
                }
                do {
                    try self.beginListening()
                    emit(["id": id, "result": ["capture": true]])
                } catch {
                    self.stop()
                    emit(["id": id, "error": ["code": -32000, "message": error.localizedDescription]])
                }
            }
        }
    }
    private func beginListening() throws {
        guard !tapInstalled else { return }
        let input = engine.inputNode
        try configureVoiceInput(input)
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw NSError(domain: "AstraVoice", code: 2, userInfo: [NSLocalizedDescriptionKey: "No microphone input is available."])
        }
        input.installTap(onBus: 0, bufferSize: microphoneBufferFrames, format: format) { buffer, _ in
            guard let mono = monoMicrophoneBuffer(buffer), let samples = mono.floatChannelData?[0] else {
                event("voice/error", ["message": "The microphone did not provide mono Float32 audio."]); return
            }
            let data = Data(bytes: samples, count: Int(mono.frameLength) * MemoryLayout<Float>.size)
            event("audio/frame", ["pcm": data.base64EncodedString(), "sampleRate": format.sampleRate])
        }
        tapInstalled = true
        engine.prepare()
        try engine.start()
    }
    func stop() {
        generation = UUID()
        if engine.isRunning { engine.stop() }
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
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
                DispatchQueue.main.async {
                    switch method {
                    case "start": voice.start(id: id)
                    case "stop": voice.stop(); emit(["id": id, "result": [:]])
                    default: emit(["id": id, "error": ["code": -32601, "message": "Unknown microphone command"]])
                    }
                }
            }
            DispatchQueue.main.async { voice.stop(); exit(0) }
        }
        RunLoop.main.run()
    }
}
#endif
