import Foundation
@preconcurrency import AVFoundation
import Speech

let recognitionLanguages = [("en", "en-GB"), ("fr", "fr-FR")]
func monoMicrophoneBuffer(_ input: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    guard let source = input.floatChannelData?[0],
          let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: input.format.sampleRate, channels: 1, interleaved: false),
          let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: input.frameLength),
          let destination = output.floatChannelData?[0] else { return nil }
    output.frameLength = input.frameLength
    destination.update(from: source, count: Int(input.frameLength))
    return output
}
final class SpeechRecognition: @unchecked Sendable {
    private var analyzers: [SpeechAnalyzer] = []
    private var inputs: [AsyncStream<AnalyzerInput>.Continuation] = []
    private var listeners: [Task<Void, Never>] = []
    private let converter: AVAudioConverter
    private let format: AVAudioFormat
    private let onError: (Error) -> Void
    private init(converter: AVAudioConverter, format: AVAudioFormat, onError: @escaping (Error) -> Void) {
        self.converter = converter; self.format = format; self.onError = onError
    }
    static func prepare(inputFormat: AVAudioFormat, onResult: @escaping (String, String, Float) -> Void, onError: @escaping (Error) -> Void) async throws -> SpeechRecognition {
        let modules = recognitionLanguages.map { DictationTranscriber(locale: Locale(identifier: $0.1), contentHints: [.farField], transcriptionOptions: [.punctuation], reportingOptions: [.volatileResults], attributeOptions: [.transcriptionConfidence]) }
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: modules),
              let converter = AVAudioConverter(from: inputFormat, to: format) else {
            throw NSError(domain: "AstraVoice", code: 2, userInfo: [NSLocalizedDescriptionKey: "This microphone format cannot be transcribed."])
        }
        let recognition = SpeechRecognition(converter: converter, format: format, onError: onError)
        do {
            for (index, module) in modules.enumerated() {
                let language = recognitionLanguages[index].0
                let analyzer = SpeechAnalyzer(modules: [module])
                let context = AnalysisContext()
                context.contextualStrings[.general] = ["Astra", "Home"]
                try await analyzer.setContext(context)
                try await analyzer.prepareToAnalyze(in: format)
                let (stream, continuation) = AsyncStream.makeStream(of: AnalyzerInput.self, bufferingPolicy: .bufferingNewest(256))
                recognition.analyzers.append(analyzer)
                recognition.inputs.append(continuation)
                recognition.listeners.append(Task {
                    var committed = ""
                    do {
                        for try await result in module.results {
                            if Task.isCancelled { return }
                            let partial = String(result.text.characters)
                            let confidences = result.text.runs.compactMap { $0.transcriptionConfidence }
                            let confidence = confidences.isEmpty ? 0.5 : confidences.reduce(0, +) / Double(confidences.count)
                            let text = (committed + " " + partial).trimmingCharacters(in: .whitespacesAndNewlines)
                            DispatchQueue.main.async { onResult(language, text, Float(confidence)) }
                            if result.isFinal { committed = text }
                        }
                    } catch { if !Task.isCancelled { DispatchQueue.main.async { onError(error) } } }
                })
                try await analyzer.start(inputSequence: stream)
            }
            return recognition
        } catch { recognition.stop(); throw error }
    }
    func append(_ input: AVAudioPCMBuffer) {
        let capacity = AVAudioFrameCount(ceil(Double(input.frameLength) * format.sampleRate / input.format.sampleRate)) + 32
        guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return }
        var supplied = false
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, state in
            if supplied { state.pointee = .noDataNow; return nil }
            supplied = true; state.pointee = .haveData; return input
        }
        if status == .error {
            let failure = error ?? NSError(domain: "AstraVoice", code: 3, userInfo: [NSLocalizedDescriptionKey: "Microphone audio could not be converted for speech recognition."])
            DispatchQueue.main.async { self.onError(failure) }
            return
        }
        if output.frameLength > 0 { for input in inputs { input.yield(AnalyzerInput(buffer: output)) } }
    }
    func finish() async throws {
        for input in inputs { input.finish() }
        for analyzer in analyzers { try await analyzer.finalizeAndFinishThroughEndOfInput() }
        for listener in listeners { await listener.value }
    }
    func stop() {
        for listener in listeners { listener.cancel() }
        for input in inputs { input.finish() }
        for analyzer in analyzers { Task { await analyzer.cancelAndFinishNow() } }
        listeners = []; inputs = []; analyzers = []
    }
}
