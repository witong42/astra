import Foundation
@preconcurrency import AVFoundation
import Speech

@main
struct VoiceTests {
    static func main() async throws {
        for text in ["Home", " home! ", "HOME."] { precondition(isHomeShortcut(text)) }
        for text in ["Home Assistant", "Je dis home", "homepage", ""] { precondition(!isHomeShortcut(text)) }
        print("HOME_SHORTCUT_VERIFIED")
        let layout = AVAudioChannelLayout(layoutTag: kAudioChannelLayoutTag_DiscreteInOrder | 9)!
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000, interleaved: false, channelLayout: layout)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024)!
        buffer.frameLength = 1024
        for channel in 0..<9 { for frame in 0..<1024 { buffer.floatChannelData![channel][frame] = channel == 0 ? 0.5 : -0.5 } }
        let mono = monoMicrophoneBuffer(buffer)!
        precondition(mono.format.channelCount == 1)
        precondition(mono.frameLength == buffer.frameLength)
        precondition(mono.floatChannelData![0][1023] == 0.5, "Microphone signal was mixed with reference channels")
        print("MONO_CHANNEL_VERIFIED")
        let file = try AVAudioFile(forReading: URL(fileURLWithPath: CommandLine.arguments[1]))
        var transcripts: [String: String] = [:]
        var failure: Error?
        let recognition = try await SpeechRecognition.prepare(inputFormat: file.processingFormat, onResult: { language, text, _ in transcripts[language] = text }, onError: { failure = $0 })
        let input = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: microphoneBufferFrames)!
        while file.framePosition < file.length {
            try file.read(into: input, frameCount: microphoneBufferFrames)
            recognition.append(input)
        }
        let silenceFrames = AVAudioFrameCount(file.processingFormat.sampleRate * silenceDelay)
        let tail = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: silenceFrames)!
        tail.frameLength = silenceFrames
        for channel in 0..<Int(file.processingFormat.channelCount) {
            tail.floatChannelData![channel].update(repeating: 0, count: Int(silenceFrames))
        }
        recognition.append(tail)
        try await recognition.finish()
        try await Task.sleep(for: .milliseconds(80))
        if let failure { throw failure }
        let language = CommandLine.arguments[2]
        let expected = CommandLine.arguments[3]
        let text = transcripts[language] ?? ""
        guard text.localizedCaseInsensitiveContains(expected) else { throw NSError(domain: "AstraVoiceTest", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing \(expected) in \(language) transcription: \(text)"]) }
        print("BILINGUAL_REPLAY_VERIFIED \(language): \(text)")
    }
}
