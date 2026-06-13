import type { IntakeChatMessage } from "@/lib/ai/intakeAgent";
import type { ReportSpecialty } from "@/lib/schema";
import { base64PCM16ToFloat32, float32ToPCM16Base64 } from "@/lib/voice/audio";
import { INTAKE_TURN_DETECTION } from "@/lib/voice/intakeVoiceInstructions";

const REALTIME_BASE = "wss://api.x.ai/v1/realtime";
const CHUNK_DURATION_MS = 100;

export type VoiceSessionStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "listening"
  | "speaking"
  | "thinking";

type VoiceSessionConfig = {
  patientName: string;
  mode?: "intake" | "doctor" | "ask";
  specialty?: ReportSpecialty;
  focus?: { metric?: string; changeSummary?: string };
  /** Plain-text health summary used to ground the "ask" voice mode. */
  context?: string;
  onStatus: (status: VoiceSessionStatus) => void;
  onMessages: (messages: IntakeChatMessage[]) => void;
  onError: (message: string) => void;
  onDisconnect?: () => void;
};

type SessionPayload = {
  token: string;
  voice: string;
  model: string;
  instructions: string;
};

export class GrokVoiceSession {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private playbackQueue: Float32Array[] = [];
  private isPlaying = false;
  private currentPlaybackSource: AudioBufferSourceNode | null = null;

  private sessionConfigured = false;
  private agentOutputActive = false;
  private inputMuted = false;
  private sampleRate = 24000;

  private messages: IntakeChatMessage[] = [];
  private assistantDraft = "";
  private userDraftIndex: number | null = null;

  constructor(private readonly config: VoiceSessionConfig) {}

  getMessages() {
    return this.messages;
  }

  async start() {
    this.ended = false;
    this.resetConversation();
    this.config.onStatus("connecting");

    const session = await this.fetchSession();
    this.sampleRate = await this.startMicrophone();

    await this.openSocket(session);
  }

  private ended = false;

  stop() {
    this.ended = true;
    this.stopMicrophone();
    this.stopPlayback();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.sessionConfigured = false;
    this.agentOutputActive = false;
    this.inputMuted = false;
    this.config.onStatus("idle");
  }

  private resetConversation() {
    this.messages = [];
    this.assistantDraft = "";
    this.userDraftIndex = null;
    this.config.onMessages([]);
  }

  private async fetchSession(): Promise<SessionPayload> {
    const res = await fetch("/api/intake/voice/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientName: this.config.patientName,
        mode: this.config.mode ?? "intake",
        specialty: this.config.specialty,
        focus: this.config.focus,
        context: this.config.context,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? "Could not start voice session");
    }

    return res.json();
  }

  private async startMicrophone(): Promise<number> {
    this.audioContext = new AudioContext();
    const nativeSampleRate = this.audioContext.sampleRate;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.mediaStream = stream;

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    const processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    const audioBuffer: Float32Array[] = [];
    let totalSamples = 0;
    const chunkSizeSamples =
      (this.audioContext.sampleRate * CHUNK_DURATION_MS) / 1000;

    processor.onaudioprocess = (event) => {
      if (this.inputMuted || this.agentOutputActive || !this.sessionConfigured)
        return;

      const inputData = event.inputBuffer.getChannelData(0);
      audioBuffer.push(new Float32Array(inputData));
      totalSamples += inputData.length;

      while (totalSamples >= chunkSizeSamples) {
        const chunk = new Float32Array(chunkSizeSamples);
        let offset = 0;

        while (offset < chunkSizeSamples && audioBuffer.length > 0) {
          const buffer = audioBuffer[0];
          const needed = chunkSizeSamples - offset;
          const available = buffer.length;

          if (available <= needed) {
            chunk.set(buffer, offset);
            offset += available;
            totalSamples -= available;
            audioBuffer.shift();
          } else {
            chunk.set(buffer.subarray(0, needed), offset);
            audioBuffer[0] = buffer.subarray(needed);
            offset += needed;
            totalSamples -= needed;
          }
        }

        this.sendAudioChunk(float32ToPCM16Base64(chunk));
      }
    };

    const silentGain = this.audioContext.createGain();
    silentGain.gain.value = 0;

    this.sourceNode.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(this.audioContext.destination);

    this.processor = processor;
    return nativeSampleRate;
  }

  private stopMicrophone() {
    this.processor?.disconnect();
    this.processor = null;
    this.sourceNode?.disconnect();
    this.sourceNode = null;
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }

  private async openSocket(session: SessionPayload): Promise<void> {
    const url = `${REALTIME_BASE}?model=${encodeURIComponent(session.model)}`;
    const protocolSets = [
      [`xai-client-secret.${session.token}`],
      [
        "realtime",
        `openai-insecure-api-key.${session.token}`,
        "openai-beta.realtime-v1",
      ],
    ];

    let lastError: Error | null = null;
    for (const protocols of protocolSets) {
      try {
        await this.connectWithProtocols(url, protocols, session);
        return;
      } catch (err) {
        lastError =
          err instanceof Error ? err : new Error("Voice connection failed");
      }
    }

    throw lastError ?? new Error("Voice connection failed");
  }

  private connectWithProtocols(
    url: string,
    protocols: string[],
    session: SessionPayload,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, protocols);
      this.ws = ws;
      let settled = false;

      ws.onopen = () => {
        settled = true;
        resolve();
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          ws.close();
          reject(new Error("Voice connection failed"));
        }
      };
      ws.onclose = () => {
        if (this.ws === ws) {
          this.ws = null;
          const hadUserSpeech =
            this.sessionConfigured &&
            this.messages.some((m) => m.role === "user" && m.content.trim());
          this.sessionConfigured = false;
          this.config.onStatus("idle");
          if (hadUserSpeech && !this.ended) {
            this.config.onDisconnect?.();
          }
        }
      };
      ws.onmessage = (event) =>
        this.handleServerEvent(event.data as string, session);
    });
  }

  private configureSession(session: SessionPayload) {
    this.send({
      type: "session.update",
      session: {
        instructions: session.instructions,
        voice: session.voice,
        turn_detection: INTAKE_TURN_DETECTION,
        audio: {
          input: {
            format: { type: "audio/pcm", rate: this.sampleRate },
            transcription: { model: "grok-transcribe", language_hint: "en" },
          },
          output: {
            format: { type: "audio/pcm", rate: this.sampleRate },
          },
        },
      },
    });
  }

  private beginAssistantTurn() {
    this.agentOutputActive = true;
    this.inputMuted = true;
    this.config.onStatus("speaking");
    this.assistantDraft = "";
  }

  private endAssistantTurn() {
    this.agentOutputActive = false;
    this.inputMuted = false;
    this.assistantDraft = "";
    this.config.onStatus("listening");
  }

  private handleServerEvent(raw: string, session: SessionPayload) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = event.type as string;

    if (type === "conversation.created" && !this.sessionConfigured) {
      this.configureSession(session);
      return;
    }

    if (type === "session.updated" && !this.sessionConfigured) {
      this.sessionConfigured = true;
      this.config.onStatus("ready");
      this.send({ type: "response.create" });
      return;
    }

    if (type === "response.created") {
      this.beginAssistantTurn();
      return;
    }

    if (
      type === "response.output_audio.delta" &&
      typeof event.delta === "string"
    ) {
      this.playAudioChunk(event.delta);
      return;
    }

    if (
      type === "response.output_audio_transcript.delta" &&
      typeof event.delta === "string"
    ) {
      this.appendAssistantTranscript(event.delta);
      return;
    }

    if (type === "response.done") {
      this.finalizeAssistantTranscript();
      this.endAssistantTurn();
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      this.stopPlayback();
      this.agentOutputActive = false;
      this.inputMuted = false;
      this.config.onStatus("listening");
      this.beginUserTranscriptPlaceholder();
      return;
    }

    if (type === "conversation.item.added" && event.item) {
      this.captureUserTranscript(event.item as Record<string, unknown>);
      return;
    }

    if (type === "conversation.item.input_audio_transcription.updated") {
      const transcript = event.transcript as string | undefined;
      if (transcript?.trim()) {
        this.updateUserTranscript(transcript.trim());
      }
      return;
    }

    if (type === "error") {
      const message =
        (event.error as { message?: string } | undefined)?.message ??
        "Voice session error";
      this.config.onError(message);
    }
  }

  private beginUserTranscriptPlaceholder() {
    if (this.userDraftIndex !== null) return;
    this.messages = [...this.messages, { role: "user", content: "" }];
    this.userDraftIndex = this.messages.length - 1;
    this.config.onMessages(this.messages);
  }

  private updateUserTranscript(text: string) {
    if (this.userDraftIndex === null) {
      this.messages = [...this.messages, { role: "user", content: text }];
      this.userDraftIndex = this.messages.length - 1;
    } else {
      const next = [...this.messages];
      next[this.userDraftIndex] = { role: "user", content: text };
      this.messages = next;
    }
    this.config.onMessages(this.messages);
  }

  private captureUserTranscript(item: Record<string, unknown>) {
    if (item.role !== "user" || !Array.isArray(item.content)) return;

    for (const entry of item.content as Record<string, unknown>[]) {
      if (
        entry.type === "input_audio" &&
        typeof entry.transcript === "string"
      ) {
        this.updateUserTranscript(entry.transcript.trim());
        this.userDraftIndex = null;
        break;
      }
    }
  }

  private appendAssistantTranscript(delta: string) {
    this.assistantDraft += delta;

    const last = this.messages[this.messages.length - 1];
    if (last?.role === "assistant") {
      const next = [...this.messages];
      next[next.length - 1] = {
        role: "assistant",
        content: this.assistantDraft,
      };
      this.messages = next;
    } else {
      this.messages = [
        ...this.messages,
        { role: "assistant", content: this.assistantDraft },
      ];
    }
    this.config.onMessages(this.messages);
  }

  private finalizeAssistantTranscript() {
    if (!this.assistantDraft.trim()) return;
    const last = this.messages[this.messages.length - 1];
    if (last?.role === "assistant") {
      const next = [...this.messages];
      next[next.length - 1] = {
        role: "assistant",
        content: this.assistantDraft.trim(),
      };
      this.messages = next;
    } else {
      this.messages = [
        ...this.messages,
        { role: "assistant", content: this.assistantDraft.trim() },
      ];
    }
    this.config.onMessages(this.messages);
    this.assistantDraft = "";
  }

  private sendAudioChunk(base64Audio: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.inputMuted || this.agentOutputActive) return;

    this.send({
      type: "input_audio_buffer.append",
      audio: base64Audio,
    });
  }

  private send(payload: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  private playAudioChunk(base64Audio: string) {
    if (!this.audioContext) return;

    try {
      const float32 = base64PCM16ToFloat32(base64Audio);
      this.playbackQueue.push(float32);
      if (!this.isPlaying) {
        this.isPlaying = true;
        this.playNextChunk();
      }
    } catch {
      // ignore malformed audio chunks
    }
  }

  private playNextChunk() {
    if (!this.audioContext) {
      this.isPlaying = false;
      return;
    }

    const chunk = this.playbackQueue.shift();
    if (!chunk) {
      this.isPlaying = false;
      this.currentPlaybackSource = null;
      return;
    }

    const audioBuffer = this.audioContext.createBuffer(
      1,
      chunk.length,
      this.audioContext.sampleRate,
    );
    audioBuffer.getChannelData(0).set(chunk);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    this.currentPlaybackSource = source;

    source.onended = () => {
      if (this.currentPlaybackSource === source) {
        this.currentPlaybackSource = null;
      }
      this.playNextChunk();
    };

    source.start();
  }

  private stopPlayback() {
    if (this.currentPlaybackSource) {
      try {
        this.currentPlaybackSource.stop();
        this.currentPlaybackSource.disconnect();
      } catch {
        // already stopped
      }
      this.currentPlaybackSource = null;
    }
    this.playbackQueue = [];
    this.isPlaying = false;
  }
}
