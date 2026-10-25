import Foundation
@preconcurrency import AVFoundation

@main
struct VoiceTests {
    static func main() throws {
        let engine = AVAudioEngine()
        try configureVoiceInput(engine.inputNode)
        let ducking = engine.inputNode.voiceProcessingOtherAudioDuckingConfiguration
        precondition(engine.inputNode.isVoiceProcessingEnabled)
        precondition(!ducking.enableAdvancedDucking.boolValue)
        precondition(ducking.duckingLevel == .min)
        print("VOICE_DUCKING_VERIFIED")
        let channels = 9
        let layout = AVAudioChannelLayout(layoutTag: kAudioChannelLayoutTag_DiscreteInOrder | UInt32(channels))!
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000, interleaved: false, channelLayout: layout)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: microphoneBufferFrames)!
        buffer.frameLength = microphoneBufferFrames
        for channel in 0..<channels {
            for frame in 0..<Int(buffer.frameLength) { buffer.floatChannelData![channel][frame] = channel == 0 ? 0.5 : -0.5 }
        }
        let mono = monoMicrophoneBuffer(buffer)!
        precondition(mono.format.channelCount == 1)
        precondition(mono.format.sampleRate == buffer.format.sampleRate)
        precondition(mono.frameLength == buffer.frameLength)
        for frame in 0..<Int(mono.frameLength) { precondition(mono.floatChannelData![0][frame] == 0.5, "Microphone signal was mixed with reference channels") }
        buffer.floatChannelData![0][0] = 0
        precondition(mono.floatChannelData![0][0] == 0.5, "Captured audio did not own its samples")
        print("MONO_CHANNEL_VERIFIED")
    }
}
