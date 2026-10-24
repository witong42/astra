import type { RemoteCommand } from "./remote-server";

const MAX_QUEUED_FRAMES = 10;
const AUDIO_LOWPASS_HZ = 7200;
const ICE_TIMEOUT_MS = 8000;
type AudioCommand = Extract<RemoteCommand, { kind: "audio" }>;
type Capture = {
  id: string;
  context: AudioContext;
  stream: MediaStream | null;
  processor: AudioWorkletNode | null;
  output: GainNode;
  peer: { id: string; connection: RTCPeerConnection } | null;
  streaming: boolean;
  queue: Float32Array[];
  uploading: boolean;
};
export class WebAudio {
  private capture: Capture | null = null;
  constructor(
    private upload: (captureId: string, pcm: string) => Promise<unknown>,
    private level: (value: number) => void,
    private failure: (error: Error) => void,
  ) {}
  async prepare() {
    this.stop();
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Le microphone nécessite un navigateur récent et une connexion HTTPS.",
      );
    const context = new AudioContext({ latencyHint: "interactive" });
    const output = context.createGain();
    output.connect(context.destination);
    const capture: Capture = {
      id: crypto.randomUUID(),
      context,
      output,
      stream: null,
      processor: null,
      peer: null,
      streaming: false,
      queue: [],
      uploading: false,
    };
    this.capture = capture;
    try {
      await context.resume();
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
        throw new Error("Microphone arrêté.");
      }
      capture.stream = stream;
      for (const track of stream.getAudioTracks())
        track.addEventListener("ended", () => {
          if (this.capture === capture)
            this.fail(
              new Error(
                "Le téléphone a arrêté le microphone. Rouvre Astra puis active la voix.",
              ),
            );
        });
      await context.audioWorklet.addModule(
        new URL("./audio-worklet.js", import.meta.url),
      );
      if (this.capture !== capture) throw new Error("Microphone arrêté.");
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
        if (!capture.streaming) return;
        if (capture.queue.length >= MAX_QUEUED_FRAMES) {
          this.fail(
            new Error(
              "La connexion au Mac est trop lente pour la voix. Relance la voix avec une meilleure connexion.",
            ),
          );
          return;
        }
        capture.queue.push(event.data.pcm);
        void this.flush(capture);
      };
      context.addEventListener("statechange", () => {
        if (this.capture === capture && context.state === "suspended")
          this.fail(
            new Error(
              "Le navigateur a suspendu l’audio. Garde Astra au premier plan puis réactive la voix.",
            ),
          );
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
  private async flush(capture: Capture) {
    if (capture.uploading) return;
    capture.uploading = true;
    try {
      while (this.capture === capture && capture.queue.length) {
        const frames = capture.queue.splice(0);
        const frame = new Float32Array(
          frames.reduce((length, chunk) => length + chunk.length, 0),
        );
        let offset = 0;
        for (const chunk of frames) {
          frame.set(chunk, offset);
          offset += chunk.length;
        }
        const bytes = new Uint8Array(
          frame.buffer,
          frame.byteOffset,
          frame.byteLength,
        );
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        await this.upload(capture.id, btoa(binary));
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
      throw new Error(
        "Le microphone du téléphone n’est plus actif. Relance la voix.",
      );
    }
    if (command.action === "offer") {
      this.closePeer(capture);
      const connection = new RTCPeerConnection();
      const peer = { id: command.callId, connection };
      capture.peer = peer;
      capture.streaming = true;
      if (!capture.stream) throw new Error("Le microphone n’est pas prêt.");
      for (const track of capture.stream.getAudioTracks())
        connection.addTrack(track, capture.stream);
      connection.addEventListener("track", (event) => {
        if (this.capture !== capture || capture.peer !== peer) return;
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        capture.context.createMediaStreamSource(stream).connect(capture.output);
      });
      connection.addEventListener("connectionstatechange", () => {
        if (
          this.capture === capture &&
          capture.peer === peer &&
          connection.connectionState === "failed"
        )
          this.fail(
            new Error(
              "La connexion audio à Codex a été interrompue. Relance la voix.",
            ),
          );
      });
      connection.createDataChannel("oai-events");
      await connection.setLocalDescription(await connection.createOffer());
      await this.gatherIce(connection);
      if (this.capture !== capture || capture.peer !== peer)
        throw new Error("La connexion audio a été remplacée.");
      const sdp = connection.localDescription?.sdp;
      if (!sdp)
        throw new Error("Le téléphone n’a pas produit de connexion audio.");
      capture.output.gain.value = 1;
      return sdp;
    }
    if (capture.peer?.id !== command.callId) {
      if (command.action === "stop") return null;
      throw new Error("Cette connexion audio a expiré.");
    }
    if (command.action === "answer") {
      await capture.peer.connection.setRemoteDescription({
        type: "answer",
        sdp: command.sdp,
      });
      await capture.context.resume();
      if (capture.context.state !== "running")
        throw new Error("Autorise l’audio du navigateur puis relance la voix.");
    } else if (command.action === "mute")
      capture.output.gain.value = command.muted ? 0 : 1;
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
        () =>
          finish(
            new Error(
              "Le téléphone n’a pas pu préparer la connexion audio. Vérifie le réseau puis relance la voix.",
            ),
          ),
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
  }
  private fail(error: Error) {
    this.stop();
    this.failure(error);
  }
  stop(captureId?: string) {
    const capture = this.capture;
    if (!capture || (captureId && capture.id !== captureId)) return;
    this.capture = null;
    capture.queue.length = 0;
    this.closePeer(capture);
    for (const track of capture.stream?.getTracks() ?? []) track.stop();
    if (capture.processor) {
      capture.processor.port.onmessage = null;
      capture.processor.disconnect();
      capture.processor.port.close();
    }
    void capture.context
      .close()
      .catch((error) =>
        this.failure(new Error(`Impossible de fermer l’audio : ${error}`)),
      );
  }
}
