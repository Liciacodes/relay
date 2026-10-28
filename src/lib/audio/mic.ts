import { VoiceError } from "./errors";

/**
 * Ask the browser for the microphone. The first call shows the permission prompt.
 * Browser errors (DOMException names) become our own VoiceError codes.
 */
export async function requestMic(): Promise<MediaStream> {
  // mediaDevices is missing on old browsers and on plain-http pages other than localhost.
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new VoiceError("unsupported");
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    switch (name) {
      case "NotAllowedError":
      case "SecurityError":
        throw new VoiceError("permission-denied");
      case "NotFoundError":
      case "OverconstrainedError":
        throw new VoiceError("no-mic");
      case "NotReadableError":
      case "AbortError":
        throw new VoiceError("mic-busy");
      default:
        throw new VoiceError("unsupported");
    }
  }
}

/** Stop every track so the browser's "mic in use" indicator turns off. */
export function releaseMic(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}
