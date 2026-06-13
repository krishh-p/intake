"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIntake } from "@/lib/IntakeContext";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

export function VoiceImportForm() {
  const { addVoiceNote, processing, error, clearError } = useIntake();
  const [recording, setRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [manualTranscript, setManualTranscript] = useState("");
  const [speechSupported, setSpeechSupported] = useState(false);
  const [success, setSuccess] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptRef = useRef("");

  useEffect(() => {
    const SR =
      typeof window !== "undefined"
        ? window.SpeechRecognition ?? window.webkitSpeechRecognition
        : undefined;
    setSpeechSupported(Boolean(SR));
  }, []);

  const startRecording = useCallback(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let finalParts = "";
      for (let i = 0; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalParts += t + " ";
        else interim += t;
      }
      transcriptRef.current = (finalParts + interim).trim();
      setLiveTranscript(transcriptRef.current);
    };

    recognition.onerror = () => {
      setRecording(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setRecording(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setRecording(true);
    setLiveTranscript("");
    transcriptRef.current = "";
    recognition.start();
  }, []);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    setRecording(false);
  }, []);

  async function handleSubmit() {
    const text = (recording ? transcriptRef.current : manualTranscript || liveTranscript).trim();
    if (recording) stopRecording();
    clearError();
    await addVoiceNote(text);
    setSuccess(true);
    setManualTranscript("");
    setLiveTranscript("");
    transcriptRef.current = "";
    setTimeout(() => setSuccess(false), 3000);
  }

  const displayText = recording ? liveTranscript : manualTranscript || liveTranscript;

  return (
    <div className="panel p-8">
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {success && (
        <Alert tone="success" className="mb-4">
          Voice note processed and added to your timeline.
        </Alert>
      )}

      {speechSupported && (
        <div className="mb-6 flex items-center gap-3">
          {!recording ? (
            <Button variant="secondary" onClick={startRecording} disabled={processing.active}>
              Start recording
            </Button>
          ) : (
            <Button variant="danger" onClick={stopRecording}>
              Stop recording
            </Button>
          )}
          {recording && (
            <span className="flex items-center gap-2 text-xs text-alert-high">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-alert-high" />
              Recording
            </span>
          )}
        </div>
      )}

      <label className="block">
        <FieldLabel>Your note</FieldLabel>
        <Textarea
          rows={8}
          value={displayText}
          onChange={(e) => setManualTranscript(e.target.value)}
          disabled={recording || processing.active}
          placeholder="Describe symptoms, medications, barriers to care, or anything relevant to your health..."
          className="mt-0"
        />
      </label>

      <Button
        onClick={handleSubmit}
        disabled={processing.active || recording}
        className="mt-6"
      >
        {processing.active ? "Processing..." : "Process note"}
      </Button>
    </div>
  );
}
