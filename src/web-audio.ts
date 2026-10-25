import { getCopy } from "./locale";
import { PcmHistory } from "./pcm-buffer";
import { PHONE_FRAME_SAMPLES, PHONE_SAMPLE_RATE } from "./phone-audio";
import type { RemoteCommand } from "./remote-server";
import type { AudioStatus } from "./types";

const MAX_QUEUED_FRAMES = PHONE_SAMPLE_RATE / PHONE_FRAME_SAMPLES;
const MILLISECONDS_PER_SECOND = 1000;
const AUDIO_LOWPASS_HZ = 7200;
const ICE_TIMEOUT_MS = 8000;
const AUDIO_HISTORY_SECONDS = 30;
type AudioFrame = { pcm: Float32Array; start: number };
type Peer = {
  id: string;
  connection: RTCPeerConnection;
  processor: AudioWorkletNode;
  destination: MediaStreamAudioDestinationNode;
  replay: { bufferedMs: number; playbackRate: number } | null;
};
type AudioCommand = Extract<RemoteCommand, { kind: "audio" }>;
type Capture = {
  id: string;
  context: AudioContext;
  stream: MediaStream | null;
  processor: AudioWorkletNode | null;
  player: HTMLAudioElement;
  priming: MediaStreamAudioDestinationNode;
  playbackEpoch: number;
  playbackError: string | null;
  peer: Peer | null;
  history: PcmHistory;
  streaming: boolean;
  queue: AudioFrame[];
  uploading: boolean;
  discardedSamples: number;
};
export class WebAudio {
  private capture: Capture | null = null;
  constructor(
    private upload: (
      captureId: string,
      pcm: string,
      startSample: number,
    ) => Promise<unknown>,
    private level: (value: number) => void,
    private failure: (error: Error) => void,
    private playback: (error: string | null) => void = () => {},
    private frame?: (pcm: Float32Array) => void,
  ) {}
  async prepare(external = false) {
    this.stop();
    if (!external && !navigator.mediaDevices?.getUserMedia)
      throw new Error(getCopy().micHttps);
    const context = new AudioContext({
      latencyHint: "interactive",
      sampleRate: PHONE_SAMPLE_RATE,
    });
    const player = new Audio();
    player.autoplay = true;
    player.setAttribute("playsinline", "");
    const priming = context.createMediaStreamDestination();
    player.srcObject = priming.stream;
    const capture: Capture = {
      id: crypto.randomUUID(),
      context,
      player,
      priming,
      playbackEpoch: 0,
      playbackError: null,
      stream: null,
      processor: null,
      peer: null,
      history: new PcmHistory(PHONE_SAMPLE_RATE * AUDIO_HISTORY_SECONDS),
      streaming: false,
      queue: [],
      uploading: false,
      discardedSamples: 0,
    };
    this.capture = capture;
    void this.playOutput(capture);
    try {
      await context.resume();
      await context.audioWorklet.addModule(
        new URL("./audio-worklet.js", import.meta.url),
      );
      if (this.capture !== capture) throw new Error(getCopy().micStopped);
      if (external) return capture.id;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (this.capture !== capture) {
        for (const track of stream.getTracks()) track.stop();
        throw new Error(getCopy().micStopped);
      }
      capture.stream = stream;
      for (const track of stream.getAudioTracks())
        track.addEventListener("ended", () => {
          if (this.capture === capture)
            this.fail(new Error(getCopy().micEnded));
        });
      const processor = new AudioWorkletNode(context, "astra-phone-audio", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      capture.processor = processor;
      const source = context.createMediaStreamSource(stream);
      const lowpass = context.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = AUDIO_LOWPASS_HZ;
      source.connect(lowpass).connect(processor).connect(context.destination);
      processor.port.onmessage = (
        event: MessageEvent<{ pcm: Float32Array; level: number }>,
      ) => {
        if (this.capture !== capture) return;
        this.level(event.data.level);
        this.frame?.(event.data.pcm);
        const start = capture.history.end;
        this.appendFrame(event.data.pcm, start);
        if (!capture.streaming) return;
        if (capture.queue.length >= MAX_QUEUED_FRAMES) {
          // Stale local-recognition audio must not stop the independent live call.
          capture.discardedSamples += capture.queue.shift()?.pcm.length ?? 0;
        }
        capture.queue.push({ pcm: event.data.pcm, start });
        void this.flush(capture);
      };
      context.addEventListener("statechange", () => {
        if (this.capture === capture && context.state === "suspended")
          this.fail(new Error(getCopy().audioSuspended));
      });
      return capture.id;
    } catch (error) {
      if (this.capture === capture) this.stop();
      throw error;
    }
  }
  enable(captureId: string) {
    if (this.capture?.id === captureId) this.capture.streaming = true;
  }
  appendFrame(pcm: Float32Array, start: number) {
    const capture = this.capture;
    if (!capture) throw new Error(getCopy().micInactive);
    if (capture.history.end === 0 && start > 0)
      capture.history = new PcmHistory(
        PHONE_SAMPLE_RATE * AUDIO_HISTORY_SECONDS,
        start,
      );
    if (start !== capture.history.end)
      throw new Error("Microphone audio lost its position. Restart voice.");
    capture.history.append(pcm);
    capture.peer?.processor.port.postMessage({ type: "pcm", pcm });
  }
  private async flush(capture: Capture) {
    if (capture.uploading) return;
    capture.uploading = true;
    try {
      while (this.capture === capture && capture.queue.length) {
        const frames = capture.queue.splice(0);
        const frame = new Float32Array(
          frames.reduce((length, chunk) => length + chunk.pcm.length, 0),
        );
        let offset = 0;
        for (const chunk of frames) {
          frame.set(chunk.pcm, offset);
          offset += chunk.pcm.length;
        }
        const bytes = new Uint8Array(
          frame.buffer,
          frame.byteOffset,
          frame.byteLength,
        );
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        await this.upload(capture.id, btoa(binary), frames[0].start);
      }
    } catch (error) {
      if (this.capture === capture)
        this.fail(error instanceof Error ? error : new Error(String(error)));
    } finally {
      capture.uploading = false;
    }
  }
  async command(command: AudioCommand) {
    const capture = this.capture;
    if (!capture || capture.id !== command.captureId) {
      if (command.action === "stop") return null;
      throw new Error(getCopy().micInactive);
    }
    if (command.action === "offer") {
      this.closePeer(capture);
      const connection = new RTCPeerConnection();
      const processor = new AudioWorkletNode(
        capture.context,
        "astra-buffered-audio",
        {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        },
      );
      const destination = capture.context.createMediaStreamDestination();
      processor.connect(destination);
      const peer: Peer = {
        id: command.callId,
        connection,
        processor,
        destination,
        replay: null,
      };
      capture.peer = peer;
      capture.streaming = true;
      const initial = capture.history.read(
        command.replayFrom ?? capture.history.end,
      );
      processor.port.postMessage({ type: "pcm", pcm: initial });
      processor.port.onmessage = (
        event: MessageEvent<{
          error?: string;
          bufferedSamples?: number;
          playbackRate?: number;
        }>,
      ) => {
        if (this.capture !== capture || capture.peer !== peer) return;
        const { bufferedSamples, playbackRate } = event.data;
        if (event.data.error) this.fail(new Error(event.data.error));
        else if (
          typeof bufferedSamples === "number" &&
          Number.isFinite(bufferedSamples) &&
          bufferedSamples >= 0 &&
          typeof playbackRate === "number" &&
          Number.isFinite(playbackRate) &&
          playbackRate >= 1
        )
          peer.replay = {
            bufferedMs:
              (bufferedSamples / PHONE_SAMPLE_RATE) * MILLISECONDS_PER_SECOND,
            playbackRate,
          };
      };
      for (const track of destination.stream.getAudioTracks())
        connection.addTrack(track, destination.stream);
      connection.addEventListener("track", (event) => {
        if (this.capture !== capture || capture.peer !== peer) return;
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        capture.player.srcObject = stream;
        void this.playOutput(capture);
      });
      connection.addEventListener("connectionstatechange", () => {
        if (
          this.capture === capture &&
          capture.peer === peer &&
          connection.connectionState === "connected"
        )
          processor.port.postMessage({ type: "start" });
        if (
          this.capture === capture &&
          capture.peer === peer &&
          connection.connectionState === "failed"
        )
          this.fail(new Error(getCopy().voiceInterrupted));
      });
      connection.createDataChannel("oai-events");
      await connection.setLocalDescription(await connection.createOffer());
      await this.gatherIce(connection);
      if (this.capture !== capture || capture.peer !== peer)
        throw new Error(getCopy().audioReplaced);
      const sdp = connection.localDescription?.sdp;
      if (!sdp) throw new Error(getCopy().noAudioOffer);
      capture.player.muted = false;
      return sdp;
    }
    if (capture.peer?.id !== command.callId) {
      if (command.action === "stop") return null;
      throw new Error(getCopy().audioExpired);
    }
    if (command.action === "answer") {
      await capture.peer.connection.setRemoteDescription({
        type: "answer",
        sdp: command.sdp,
      });
      await capture.context.resume();
      if (capture.context.state !== "running")
        throw new Error(getCopy().allowAudio);
      if (capture.peer.connection.connectionState === "connected")
        capture.peer.processor.port.postMessage({ type: "start" });
    } else if (command.action === "mute") capture.player.muted = command.muted;
    else this.closePeer(capture);
    return null;
  }
  private gatherIce(connection: RTCPeerConnection) {
    if (connection.iceGatheringState === "complete") return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        connection.removeEventListener("icegatheringstatechange", changed);
        error ? reject(error) : resolve();
      };
      const changed = () => {
        if (connection.iceGatheringState === "complete") finish();
      };
      const timer = setTimeout(
        () => finish(new Error(getCopy().audioPreparationFailed)),
        ICE_TIMEOUT_MS,
      );
      connection.addEventListener("icegatheringstatechange", changed);
      changed();
    });
  }
  private closePeer(capture: Capture) {
    const peer = capture.peer;
    capture.peer = null;
    peer?.connection.close();
    if (peer) {
      peer.processor.disconnect();
      peer.processor.port.onmessage = null;
      peer.processor.port.close();
      for (const track of peer.destination.stream.getTracks()) track.stop();
      capture.playbackEpoch++;
      capture.player.pause();
      capture.player.srcObject = null;
      capture.playbackError = null;
      this.playback(null);
    }
  }
  private async playOutput(capture: Capture) {
    const epoch = ++capture.playbackEpoch;
    try {
      await capture.player.play();
      if (this.capture !== capture || capture.playbackEpoch !== epoch)
        return false;
      capture.playbackError = null;
      this.playback(null);
      return true;
    } catch (error) {
      if (this.capture !== capture || capture.playbackEpoch !== epoch)
        return false;
      capture.playbackError =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? getCopy().playbackBlocked
          : getCopy().playbackFailed(
              error instanceof Error ? error.message : String(error),
            );
      this.playback(capture.playbackError);
      return false;
    }
  }
  async resumeOutput() {
    const capture = this.capture;
    if (!capture) throw new Error(getCopy().voiceBeforeSound);
    const playing = this.playOutput(capture);
    await capture.context.resume();
    if (!(await playing) && this.capture === capture)
      throw new Error(capture.playbackError ?? getCopy().playbackStillBlocked);
  }
  async diagnostics(): Promise<AudioStatus> {
    const capture = this.capture;
    if (!capture)
      return {
        active: false,
        context: "inactive",
        connection: "inactive",
        output: null,
        inbound: null,
      };
    const connection = capture.peer?.connection;
    const inbound = connection
      ? { bytes: 0, packets: 0, energy: null as number | null }
      : null;
    if (connection && inbound)
      (await connection.getStats()).forEach((report) => {
        if (report.type !== "inbound-rtp" || report.kind !== "audio") return;
        inbound.bytes += report.bytesReceived ?? 0;
        inbound.packets += report.packetsReceived ?? 0;
        if (typeof report.totalAudioEnergy === "number")
          inbound.energy = (inbound.energy ?? 0) + report.totalAudioEnergy;
      });
    return {
      active: true,
      replay: capture.peer?.replay ?? null,
      localInput: {
        queuedMs:
          (capture.queue.reduce(
            (samples, frame) => samples + frame.pcm.length,
            0,
          ) /
            PHONE_SAMPLE_RATE) *
          MILLISECONDS_PER_SECOND,
        discardedMs:
          (capture.discardedSamples / PHONE_SAMPLE_RATE) *
          MILLISECONDS_PER_SECOND,
      },
      context: capture.context.state,
      connection: connection?.connectionState ?? "inactive",
      output: {
        paused: capture.player.paused,
        muted: capture.player.muted,
        readyState: capture.player.readyState,
        blocked: capture.playbackError !== null,
      },
      inbound,
    };
  }
  private fail(error: Error) {
    this.stop();
    this.failure(error);
  }
  stop(captureId?: string) {
    const capture = this.capture;
    if (!capture || (captureId && capture.id !== captureId)) return;
    this.capture = null;
    capture.playbackEpoch++;
    capture.queue.length = 0;
    this.closePeer(capture);
    capture.player.pause();
    capture.player.srcObject = null;
    for (const track of capture.priming.stream.getTracks()) track.stop();
    this.playback(null);
    for (const track of capture.stream?.getTracks() ?? []) track.stop();
    if (capture.processor) {
      capture.processor.port.onmessage = null;
      capture.processor.disconnect();
      capture.processor.port.close();
    }
    void capture.context
      .close()
      .catch((error) =>
        this.failure(new Error(getCopy().audioCloseFailed(String(error)))),
      );
  }
}
