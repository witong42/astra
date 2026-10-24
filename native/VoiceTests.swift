import Foundation
@preconcurrency import AVFoundation
import Speech

@main
struct VoiceTests {
    @MainActor
    static func verifyHomeConversation() async throws {
        let pause = Duration.milliseconds(Int(silenceDelay * 1000) + 200)
        var homes = 0
        var resets = 0
        var transcript = ""
        var observations: [(String, String)] = []
        let shortcut = HomeShortcutRecognition(onHome: { homes += 1 }, onReset: { resets += 1; transcript = "" }, onRecognition: { observations.append(($0, $1)) })
        transcript = "Tell me about the dashboard"
        shortcut.received(language: "en", text: transcript)
        shortcut.received(language: "en", text: transcript)
        precondition(observations.count == 1, "Identical recognition observations were duplicated")
        try await Task.sleep(for: pause)
        guard resets == 1 else { throw NSError(domain: "AstraVoiceTest", code: 4, userInfo: [NSLocalizedDescriptionKey: "Ordinary conversation was not cleared before the next Home shortcut"]) }
        transcript += " Home Home"
        shortcut.received(language: "en", text: transcript)
        shortcut.received(language: "fr", text: "Homme homme")
        try await Task.sleep(for: pause)
        precondition(homes == 1 && resets == 2, "Home after conversation was lost or a French result canceled it")
        precondition(observations.contains { $0.0 == "fr" && $0.1 == "Homme homme" }, "French recognition was not observable")
        shortcut.received(language: "en", text: "Home")
        shortcut.received(language: "en", text: "Home Assistant")
        try await Task.sleep(for: pause)
        precondition(homes == 1 && resets == 3, "A longer phrase triggered Home or remained in the recognition buffer")
        shortcut.received(language: "en", text: "Home")
        shortcut.cancel()
        try await Task.sleep(for: pause)
        precondition(homes == 1 && resets == 3, "A stopped listener navigated Home")
        print("HOME_CONVERSATION_VERIFIED")
    }
    static func main() async throws {
        try await verifyHomeConversation()
        for text in ["Home", " home! ", "HOME.", "Home Home"] { precondition(isHomeShortcut(text)) }
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
