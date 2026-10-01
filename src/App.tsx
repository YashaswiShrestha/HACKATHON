import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Eye,
  HelpCircle,
  BookOpen,
  Search,
  RefreshCw,
  Square,
  Play,
  Upload,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Keyboard,
  Radio,
  Sun,
  Moon,
  ArrowUpRight,
} from 'lucide-react';
import { DEMO_SCENES, DemoScene } from './data/demoScenes';
import { soundFeedback } from './utils/sound';

type VistaMode = 'describe' | 'ask' | 'read' | 'find';
type AppStatus =
  | 'camera_ready'
  | 'demo_ready'
  | 'jarvis_confirmed'
  | 'listening'
  | 'analyzing'
  | 'speaking'
  | 'error';

interface AnalysisResult {
  mode: VistaMode;
  query?: string;
  spokenResponse: string;
  fullText: string;
  hasMoreText: boolean;
  foundStatus: string;
  keyItems: string[];
  audioBase64?: string | null;
  timestamp: string;
}

// Type declarations for Web Speech API
interface SpeechRecognitionEvent extends Event {
  resultIndex?: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

const JARVIS_CONFIRMATION_SPEECH = "Yes, I'm listening. Go ahead.";

// Matcher for the wake word "Jarvis" and direct phonetic spellings produced by speech-to-text engines
const JARVIS_WAKE_REGEX =
  /\b(?:hey|hi|ok|okay|yo|hello)?\s*(?:jarvis|jervis|gervais|javis|charvis|harvis|darvis|marvis|garvis|carvis|travis|chavez|jarv|jarvez|jarvus|harvest)\b/i;

const JARVIS_SPLIT_REGEX =
  /^.*?\b(?:hey|hi|ok|okay|yo|hello)?\s*(?:jarvis|jervis|gervais|javis|charvis|harvis|darvis|marvis|garvis|carvis|travis|chavez|jarv|jarvez|jarvus|harvest)\b[\s,.:;!?-]*/i;

function containsJarvisWakeWord(input: string): boolean {
  return JARVIS_WAKE_REGEX.test((input || '').trim());
}

// Strip "Jarvis" (and any pre-wake filler words) from the start of a command phrase
function stripLeadingJarvis(input: string): string {
  const trimmed = (input || '').trim();
  if (!trimmed) return '';
  if (JARVIS_WAKE_REGEX.test(trimmed)) {
    return trimmed.replace(JARVIS_SPLIT_REGEX, '').trim();
  }
  return trimmed;
}

function getSupportedAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

export default function App() {
  // Visual Theme State: Luminous Studio Light (Default) or High-Contrast Obsidian
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(false);

  // Camera & Input Source State
  const [sourceMode, setSourceMode] = useState<'camera' | 'demo' | 'upload'>('camera');
  const [activeDemoScene, setActiveDemoScene] = useState<DemoScene>(DEMO_SCENES[0]);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraNotice, setCameraNotice] = useState<string | null>(null);
  const [imageLoadError, setImageLoadError] = useState<boolean>(false);
  const [isVideoStreaming, setIsVideoStreaming] = useState<boolean>(false);

  // Operational & Accessibility State
  const [status, setStatus] = useState<AppStatus>('camera_ready');
  const [statusMessage, setStatusMessage] = useState<string>(
    'Camera ready · Say "Jarvis" to activate microphone'
  );
  const [activePromptMode, setActivePromptMode] = useState<'ask' | 'find' | null>(null);
  const [textInputQuery, setTextInputQuery] = useState<string>('');
  const [liveSpeechDraft, setLiveSpeechDraft] = useState<string>('');
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const [autoSpeak, setAutoSpeak] = useState<boolean>(true);
  const [showFullReadText, setShowFullReadText] = useState<boolean>(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState<boolean>(false);

  // Hands-Free Wake Word ("Jarvis") & Live Mic Hardware State
  const [wakeWordEnabled, setWakeWordEnabled] = useState<boolean>(true);
  const [micPermissionGranted, setMicPermissionGranted] = useState<boolean>(false);
  const [micVolumeLevel, setMicVolumeLevel] = useState<number>(0);
  const [jarvisConfirmedBanner, setJarvisConfirmedBanner] = useState<string | null>(null);
  const [isCheckingWakeWordUI, setIsCheckingWakeWordUI] = useState<boolean>(false);

  // Latest AI Response Transcript
  const [latestResult, setLatestResult] = useState<AnalysisResult>({
    mode: 'describe',
    spokenResponse:
      'Welcome to VISTA. Say "Jarvis" anytime—I will first confirm that I heard you, and then let you speak your request.',
    fullText: '',
    hasMoreText: false,
    foundStatus: 'not_applicable',
    keyItems: [],
    audioBase64: null,
    timestamp: 'Ready',
  });

  // Refs for Camera & Audio Playback
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewImgRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const activeBufferSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const preloadedConfirmAudioRef = useRef<string | null>(null);
  const confirmStageTimeoutRef = useRef<number | null>(null);

  // Refs for Unified Microphone Hardware, Pre-Buffered Rolling Recorder & Speech Recognition
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadIntervalRef = useRef<number | null>(null);
  const hasAnalyserProducedSignalRef = useRef<boolean>(false);
  const ambientNoiseFloorRef = useRef<number>(0.006);

  const activeRecorderRef = useRef<MediaRecorder | null>(null);
  const isRecordingClipRef = useRef<boolean>(false);
  const clipModeRef = useRef<'wake_check' | 'command'>('wake_check');
  const voiceFramesInClipRef = useRef<number>(0);
  const clipStartTimeRef = useRef<number>(0);
  const firstVoiceTimeRef = useRef<number>(0);
  const lastVoiceTimeRef = useRef<number>(0);

  const speechRecRef = useRef<SpeechRecognitionInstance | null>(null);
  const webSpeechSilenceTimerRef = useRef<number | null>(null);
  const recognizedDraftRef = useRef<string>('');
  const lastProcessedCommandTimeRef = useRef<number>(0);
  const wakeActivatedAtRef = useRef<number>(0);
  const consumedWakeResultIndexRef = useRef<number>(-1);

  const pendingVoiceModeRef = useRef<'ask' | 'find' | 'auto'>('auto');
  const statusRef = useRef<AppStatus>(status);
  const wakeWordEnabledRef = useRef<boolean>(wakeWordEnabled);
  const sourceModeRef = useRef<'camera' | 'demo' | 'upload'>(sourceMode);
  const isCheckingWakeRef = useRef<boolean>(false);
  const isTranscribingCommandRef = useRef<boolean>(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    wakeWordEnabledRef.current = wakeWordEnabled;
  }, [wakeWordEnabled]);

  useEffect(() => {
    sourceModeRef.current = sourceMode;
  }, [sourceMode]);

  // Preload the human voice confirmation for "Jarvis" so confirming plays with zero latency
  useEffect(() => {
    let cancelled = false;
    fetch('/api/vista/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: JARVIS_CONFIRMATION_SPEECH }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.audioBase64) {
          preloadedConfirmAudioRef.current = data.audioBase64;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const getDefaultReadyMessage = useCallback(
    (mode = sourceModeRef.current, wakeOn = wakeWordEnabledRef.current) => {
      const base =
        mode === 'camera'
          ? 'Camera ready'
          : mode === 'demo'
            ? 'Demo scene ready'
            : 'Uploaded image ready';
      return wakeOn ? `${base} · Say "Jarvis" to activate mic` : base;
    },
    []
  );

  // Stop any active neural audio or browser speech synthesis
  const stopSpeaking = useCallback(() => {
    if (activeBufferSourceRef.current) {
      try {
        activeBufferSourceRef.current.onended = null;
        activeBufferSourceRef.current.stop();
      } catch {
        // ignore
      }
      activeBufferSourceRef.current = null;
    }
    if (activeAudioElementRef.current) {
      try {
        activeAudioElementRef.current.pause();
        activeAudioElementRef.current.currentTime = 0;
      } catch {
        // ignore
      }
      activeAudioElementRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setStatus((prev) =>
      prev === 'speaking'
        ? sourceModeRef.current === 'camera'
          ? 'camera_ready'
          : 'demo_ready'
        : prev
    );
    setStatusMessage((prev) =>
      prev === 'Speaking...' ? getDefaultReadyMessage() : prev
    );
  }, [getDefaultReadyMessage]);

  // Play warm, friendly human neural voice WAV via unlocked Web Audio API + HTMLAudioElement + SpeechSynthesis fallback
  const playHumanVoice = useCallback(
    async (text: string, preloadedAudioBase64?: string | null, forceSpeak = false) => {
      if (!text) return;
      if (!autoSpeak && !forceSpeak) {
        setStatus(sourceModeRef.current === 'camera' ? 'camera_ready' : 'demo_ready');
        setStatusMessage(getDefaultReadyMessage());
        return;
      }

      stopSpeaking();
      setStatus('speaking');
      setStatusMessage('Speaking...');

      let wavBase64 = preloadedAudioBase64 || null;

      if (!wavBase64) {
        try {
          const res = await fetch('/api/vista/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });
          const data = await res.json();
          if (data.audioBase64) {
            wavBase64 = data.audioBase64;
          }
        } catch {
          wavBase64 = null;
        }
      }

      // 1. Primary Playback: Unlocked Web Audio API AudioBufferSourceNode (immune to async fetch autoplay blocks)
      if (wavBase64) {
        try {
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (!audioCtxRef.current && AudioCtx) {
            audioCtxRef.current = new AudioCtx();
          }
          const ctx = audioCtxRef.current;
          if (ctx) {
            if (ctx.state === 'suspended') {
              await ctx.resume().catch(() => {});
            }
            if (ctx.state === 'running') {
              const binaryStr = window.atob(wavBase64);
              const bytes = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
              }
              const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
              const sourceNode = ctx.createBufferSource();
              sourceNode.buffer = audioBuffer;
              sourceNode.playbackRate.value = speechRate;
              sourceNode.connect(ctx.destination);
              activeBufferSourceRef.current = sourceNode;

              sourceNode.onended = () => {
                activeBufferSourceRef.current = null;
                setStatus(sourceModeRef.current === 'camera' ? 'camera_ready' : 'demo_ready');
                setStatusMessage(getDefaultReadyMessage());
              };

              sourceNode.start(0);
              return;
            }
          }
        } catch (err) {
          console.warn('Web Audio decode/play fallback to HTMLAudioElement:', err);
        }

        // 2. Secondary Playback: HTMLAudioElement
        try {
          const audio = new Audio(`data:audio/wav;base64,${wavBase64}`);
          activeAudioElementRef.current = audio;
          audio.playbackRate = speechRate;

          audio.onended = () => {
            activeAudioElementRef.current = null;
            setStatus(sourceModeRef.current === 'camera' ? 'camera_ready' : 'demo_ready');
            setStatusMessage(getDefaultReadyMessage());
          };

          audio.onerror = () => {
            activeAudioElementRef.current = null;
            setStatus(sourceModeRef.current === 'camera' ? 'camera_ready' : 'demo_ready');
            setStatusMessage(getDefaultReadyMessage());
          };

          await audio.play();
          return;
        } catch (err) {
          console.warn('HTMLAudioElement play blocked, falling back to speechSynthesis:', err);
        }
      }

      // 3. Guaranteed Browser SpeechSynthesis Fallback
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
          window.speechSynthesis.resume();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = speechRate;
          utterance.pitch = 1.02;

          const voices = window.speechSynthesis.getVoices();
          const preferredVoice =
            voices.find(
              (v) =>
                v.lang.startsWith('en') &&
                (v.name.includes('Natural') ||
                  v.name.includes('Online') ||
                  v.name.includes('Google') ||
                  v.name.includes('Samantha'))
            ) || voices.find((v) => v.lang.startsWith('en'));

          if (preferredVoice) {
            utterance.voice = preferredVoice;
          }

          utterance.onend = () => {
            setStatus(sourceModeRef.current === 'camera' ? 'camera_ready' : 'demo_ready');
            setStatusMessage(getDefaultReadyMessage());
          };
          utterance.onerror = () => {
            setStatus(sourceModeRef.current === 'camera' ? 'camera_ready' : 'demo_ready');
            setStatusMessage(getDefaultReadyMessage());
          };

          window.speechSynthesis.speak(utterance);
          return;
        } catch {
          // ignore
        }
      }

      setStatus(sourceModeRef.current === 'camera' ? 'camera_ready' : 'demo_ready');
      setStatusMessage(getDefaultReadyMessage());
    },
    [autoSpeak, getDefaultReadyMessage, speechRate, stopSpeaking]
  );

  // Initialize or switch live camera stream
  const startCamera = useCallback(async () => {
    setIsVideoStreaming(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setSourceMode('demo');
      setCameraNotice(
        'Camera API is unavailable in this browser. Switched to interactive Demo Scene mode.'
      );
      setStatus('demo_ready');
      setStatusMessage(getDefaultReadyMessage('demo'));
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      } catch {
        stream = null;
      }
    }

    if (!stream) {
      setSourceMode('demo');
      setCameraNotice(
        'Camera access was unavailable or declined. Demo Scene Mode is active so you can test all features immediately.'
      );
      setStatus('demo_ready');
      setStatusMessage(getDefaultReadyMessage('demo'));
      return;
    }

    streamRef.current = stream;
    setSourceMode('camera');
    sourceModeRef.current = 'camera';
    setCameraNotice(null);
    setStatus('camera_ready');
    setStatusMessage(getDefaultReadyMessage('camera'));

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.onloadedmetadata = () => {
        videoRef.current?.play().catch(() => {});
        setIsVideoStreaming(true);
      };
      await videoRef.current.play().catch(() => {});
      setIsVideoStreaming(true);
    }
  }, [facingMode, getDefaultReadyMessage]);

  useEffect(() => {
    if (sourceMode === 'camera') {
      startCamera();
    } else {
      setIsVideoStreaming(false);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setStatus('demo_ready');
      setStatusMessage(getDefaultReadyMessage(sourceMode));
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [sourceMode, startCamera, getDefaultReadyMessage]);

  // Capture current visual frame safely as base64 JPEG (waits for live video frame if warming up)
  const captureCurrentFrameBase64 = useCallback(async (): Promise<string | null> => {
    try {
      const currentSource = sourceModeRef.current;
      const canvas = document.createElement('canvas');
      const maxDim = 1024;

      if (currentSource === 'camera' && videoRef.current) {
        const video = videoRef.current;
        if (streamRef.current && video.srcObject !== streamRef.current) {
          video.srcObject = streamRef.current;
          await video.play().catch(() => {});
        }

        // Wait up to 700ms if the camera stream just started and videoWidth is still 0
        for (let attempt = 0; attempt < 7; attempt++) {
          if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
            break;
          }
          await new Promise((r) => setTimeout(r, 100));
        }

        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 480;
        if (video.readyState >= 1) {
          const scale = Math.min(1, maxDim / Math.max(vw, vh));
          canvas.width = Math.max(1, Math.round(vw * scale));
          canvas.height = Math.max(1, Math.round(vh * scale));
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
            if (dataUrl && dataUrl.length > 500) {
              return dataUrl;
            }
          }
        }
        return null;
      }

      if (currentSource === 'upload' && uploadedImageUrl && uploadedImageUrl.length > 500) {
        return uploadedImageUrl;
      }

      if (
        previewImgRef.current &&
        previewImgRef.current.complete &&
        previewImgRef.current.naturalWidth > 0 &&
        previewImgRef.current.naturalHeight > 0
      ) {
        const img = previewImgRef.current;
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        const scale = Math.min(1, maxDim / Math.max(iw, ih));
        canvas.width = Math.max(1, Math.round(iw * scale));
        canvas.height = Math.max(1, Math.round(ih * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        if (dataUrl && dataUrl.length > 500) {
          return dataUrl;
        }
      }
    } catch (err) {
      console.warn('Client canvas capture error:', err);
    }
    return null;
  }, [uploadedImageUrl]);

  // Execute Gemini Multimodal Vision Analysis + Human Voice Playback
  const runVisualAnalysis = useCallback(
    async (mode: VistaMode, queryText = '') => {
      stopSpeaking();
      soundFeedback.playCapture();
      setShowFullReadText(false);
      setStatus('analyzing');

      const modeActionLabels: Record<VistaMode, string> = {
        describe: 'Analyzing live camera view...',
        ask: `Analyzing question: "${queryText}"...`,
        read: 'Reading visible text...',
        find: `Searching view for "${queryText}"...`,
      };
      setStatusMessage(modeActionLabels[mode]);

      const frameBase64 = await captureCurrentFrameBase64();

      try {
        const response = await fetch('/api/vista/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            sourceMode: sourceModeRef.current,
            imageBase64: frameBase64 || '',
            mimeType: 'image/jpeg',
            query: queryText,
            demoSceneId: activeDemoScene.id,
          }),
        });

        const data = await response.json();

        if (!response.ok || data.error) {
          throw new Error(data.error || 'Visual analysis could not complete.');
        }

        soundFeedback.playSuccess();
        const spoken =
          data.spokenResponse || 'I could not determine details from the current view.';
        const newResult: AnalysisResult = {
          mode,
          query: queryText || undefined,
          spokenResponse: spoken,
          fullText: data.fullText || '',
          hasMoreText: Boolean(data.hasMoreText && data.fullText),
          foundStatus: data.foundStatus || 'not_applicable',
          keyItems: Array.isArray(data.keyItems) ? data.keyItems : [],
          audioBase64: data.audioBase64 || null,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };

        setLatestResult(newResult);
        setActivePromptMode(null);
        setTextInputQuery('');
        setLiveSpeechDraft('');
        await playHumanVoice(spoken, data.audioBase64);
      } catch (err: unknown) {
        soundFeedback.playError();
        const fallbackMsg =
          err instanceof Error
            ? err.message
            : 'Unable to analyze the image right now. Please try again.';
        setStatus('error');
        setStatusMessage('Analysis notice');
        setLatestResult({
          mode,
          query: queryText || undefined,
          spokenResponse: fallbackMsg,
          fullText: '',
          hasMoreText: false,
          foundStatus: 'unclear',
          keyItems: [],
          audioBase64: null,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
        await playHumanVoice(fallbackMsg, null);
      }
    },
    [activeDemoScene.id, captureCurrentFrameBase64, playHumanVoice, stopSpeaking]
  );

  // Start a clean, self-contained MediaRecorder session
  const startFreshRecorderClip = useCallback((mode: 'wake_check' | 'command') => {
    if (!micStreamRef.current) return;

    if (activeRecorderRef.current && activeRecorderRef.current.state !== 'inactive') {
      try {
        activeRecorderRef.current.onstop = null;
        activeRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }

    try {
      const mime = getSupportedAudioMimeType();
      const recorder = mime
        ? new MediaRecorder(micStreamRef.current, { mimeType: mime })
        : new MediaRecorder(micStreamRef.current);

      const localChunks: Blob[] = [];
      activeRecorderRef.current = recorder;
      isRecordingClipRef.current = true;
      clipModeRef.current = mode;
      voiceFramesInClipRef.current = 0;
      const now = Date.now();
      clipStartTimeRef.current = now;
      firstVoiceTimeRef.current = 0;
      lastVoiceTimeRef.current = now;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          localChunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        isRecordingClipRef.current = false;
        const finalMode = clipModeRef.current;
        const framesCount = voiceFramesInClipRef.current;
        const fullBlob = new Blob(localChunks, { type: recorder.mimeType || 'audio/webm' });

        // When AnalyserNode is active, ignore pure silence (0 voice frames) or >65 frames of continuous background noise
        if (
          finalMode === 'wake_check' &&
          hasAnalyserProducedSignalRef.current &&
          (framesCount < 1 || framesCount > 65)
        ) {
          return;
        }
        handleRecordedClipComplete(fullBlob, recorder.mimeType || 'audio/webm', finalMode);
      };

      recorder.start();
    } catch (err) {
      console.warn('Could not start MediaRecorder:', err);
      isRecordingClipRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // STAGE 2 OF WAKE FLOW: Open the microphone for the user's spoken request AFTER confirming "Jarvis"
  const openMicrophoneForUserSpeech = useCallback(
    (intentMode: 'ask' | 'find' | 'auto' = 'auto', confirmedFromJarvis = false) => {
      if (confirmStageTimeoutRef.current) {
        window.clearTimeout(confirmStageTimeoutRef.current);
        confirmStageTimeoutRef.current = null;
      }

      pendingVoiceModeRef.current = intentMode;
      recognizedDraftRef.current = '';
      setLiveSpeechDraft('');
      wakeActivatedAtRef.current = Date.now();

      soundFeedback.playListenStart();
      setStatus('listening');
      statusRef.current = 'listening';

      if (confirmedFromJarvis) {
        setJarvisConfirmedBanner(
          '✓ "Jarvis" Confirmed · Microphone is OPEN — Speak what you need now'
        );
        setStatusMessage('Jarvis Confirmed · Speak your request now...');
      } else {
        setJarvisConfirmedBanner(null);
        setStatusMessage(
          intentMode === 'find'
            ? 'Microphone Active · Say what object to find...'
            : intentMode === 'ask'
              ? 'Microphone Active · Ask your question about the scene...'
              : 'Microphone Active · Say what you need...'
        );
      }

      startFreshRecorderClip('command');
    },
    [startFreshRecorderClip]
  );

  // STAGE 1 OF WAKE FLOW: First confirm to the user (visually + via friendly human voice) that they said "Jarvis",
  // and ONLY after confirming, open the microphone to let the user speak!
  const confirmJarvisAndThenLetUserSpeak = useCallback(
    async (intentMode: 'ask' | 'find' | 'auto' = 'auto') => {
      if (
        statusRef.current === 'jarvis_confirmed' ||
        statusRef.current === 'listening' ||
        statusRef.current === 'analyzing'
      ) {
        return;
      }

      // Stop any active recorder or prior audio immediately
      if (activeRecorderRef.current && activeRecorderRef.current.state !== 'inactive') {
        try {
          activeRecorderRef.current.onstop = null;
          activeRecorderRef.current.stop();
        } catch {
          // ignore
        }
        isRecordingClipRef.current = false;
      }
      stopSpeaking();

      pendingVoiceModeRef.current = intentMode;
      recognizedDraftRef.current = '';

      // 1. Set explicit "Jarvis Confirmed" status & visual banner FIRST
      setStatus('jarvis_confirmed');
      statusRef.current = 'jarvis_confirmed';
      setJarvisConfirmedBanner(
        '✓ Confirmed: You said "Jarvis" — Answering "Yes, I\'m listening. Go ahead..."'
      );
      setStatusMessage('Confirmed "Jarvis" · "Yes, I\'m listening. Go ahead..."');
      setLiveSpeechDraft('✓ Confirmed you said "Jarvis"');

      // Play confirmation chime
      soundFeedback.playWakeWord();

      let hasTransitionedToListen = false;
      const finishConfirmationAndLetUserSpeak = () => {
        if (hasTransitionedToListen) return;
        hasTransitionedToListen = true;
        if (statusRef.current === 'jarvis_confirmed') {
          openMicrophoneForUserSpeech(intentMode, true);
        }
      };

      // Safety fallback timer so even if browser audio is muted/blocked, the mic opens right after confirmation
      confirmStageTimeoutRef.current = window.setTimeout(
        finishConfirmationAndLetUserSpeak,
        2400
      );

      if (!autoSpeak) {
        confirmStageTimeoutRef.current = window.setTimeout(
          finishConfirmationAndLetUserSpeak,
          700
        );
        return;
      }

      // 2. Speak warm human voice confirmation ("Yes, I'm listening. Go ahead.") and then open mic on ended
      let wavBase64 = preloadedConfirmAudioRef.current;
      if (!wavBase64) {
        try {
          const res = await fetch('/api/vista/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: JARVIS_CONFIRMATION_SPEECH }),
          });
          const data = await res.json();
          if (data?.audioBase64) {
            wavBase64 = data.audioBase64;
            preloadedConfirmAudioRef.current = data.audioBase64;
          }
        } catch {
          wavBase64 = null;
        }
      }

      if (statusRef.current !== 'jarvis_confirmed') return;

      // Try Web Audio API playback first
      if (wavBase64) {
        try {
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (!audioCtxRef.current && AudioCtx) {
            audioCtxRef.current = new AudioCtx();
          }
          const ctx = audioCtxRef.current;
          if (ctx) {
            if (ctx.state === 'suspended') {
              await ctx.resume().catch(() => {});
            }
            if (ctx.state === 'running') {
              const binaryStr = window.atob(wavBase64);
              const bytes = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
              }
              const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
              const sourceNode = ctx.createBufferSource();
              sourceNode.buffer = audioBuffer;
              sourceNode.playbackRate.value = speechRate;
              sourceNode.connect(ctx.destination);
              activeBufferSourceRef.current = sourceNode;

              sourceNode.onended = () => {
                activeBufferSourceRef.current = null;
                finishConfirmationAndLetUserSpeak();
              };

              sourceNode.start(0);
              return;
            }
          }
        } catch {
          // Fall through to HTMLAudioElement
        }

        try {
          const audio = new Audio(`data:audio/wav;base64,${wavBase64}`);
          activeAudioElementRef.current = audio;
          audio.playbackRate = speechRate;
          audio.onended = () => {
            activeAudioElementRef.current = null;
            finishConfirmationAndLetUserSpeak();
          };
          audio.onerror = () => {
            activeAudioElementRef.current = null;
            finishConfirmationAndLetUserSpeak();
          };
          await audio.play();
          return;
        } catch {
          // Fall through to speechSynthesis
        }
      }

      // Fallback to browser speechSynthesis for confirmation
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
          window.speechSynthesis.resume();
          const utterance = new SpeechSynthesisUtterance(JARVIS_CONFIRMATION_SPEECH);
          utterance.rate = speechRate;
          utterance.pitch = 1.02;
          utterance.onend = () => finishConfirmationAndLetUserSpeak();
          utterance.onerror = () => finishConfirmationAndLetUserSpeak();
          window.speechSynthesis.speak(utterance);
          return;
        } catch {
          // ignore
        }
      }

      // If all audio output methods were blocked before user gesture, open mic after brief visual confirmation
      confirmStageTimeoutRef.current = window.setTimeout(
        finishConfirmationAndLetUserSpeak,
        850
      );
    },
    [autoSpeak, openMicrophoneForUserSpeech, speechRate, stopSpeaking]
  );

  // Route the user's spoken request (after "Jarvis" was confirmed and microphone opened) to the right VISTA action
  const executeSpokenCommand = useCallback(
    (rawTranscript: string) => {
      const now = Date.now();
      if (now - lastProcessedCommandTimeRef.current < 1500) {
        return;
      }

      const cleaned = stripLeadingJarvis(rawTranscript);

      // If the transcript only contained the wake word "Jarvis", keep the microphone open for their command
      if (!cleaned) {
        if (statusRef.current !== 'listening' && statusRef.current !== 'jarvis_confirmed') {
          confirmJarvisAndThenLetUserSpeak('auto');
        }
        return;
      }

      lastProcessedCommandTimeRef.current = now;
      setJarvisConfirmedBanner(null);
      const lower = cleaned.toLowerCase();

      if (
        latestResult.hasMoreText &&
        latestResult.fullText &&
        (lower === 'yes' ||
          lower.includes('read more') ||
          lower.includes('full text') ||
          lower.includes('keep reading'))
      ) {
        setShowFullReadText(true);
        playHumanVoice(latestResult.fullText, null, true);
        return;
      }

      const targetMode = pendingVoiceModeRef.current;
      pendingVoiceModeRef.current = 'auto';

      if (targetMode === 'ask') {
        runVisualAnalysis('ask', cleaned);
        return;
      }

      if (targetMode === 'find') {
        runVisualAnalysis('find', cleaned);
        return;
      }

      if (
        lower === 'describe' ||
        lower.includes('describe the scene') ||
        lower.includes('describe scene') ||
        lower.includes('what do you see') ||
        lower.includes('what is in front of me') ||
        lower.includes('what is around me')
      ) {
        runVisualAnalysis('describe');
      } else if (
        lower === 'read' ||
        lower.startsWith('read ') ||
        lower.includes('read the sign') ||
        lower.includes('read text')
      ) {
        runVisualAnalysis('read');
      } else if (
        lower.startsWith('find ') ||
        lower.startsWith('locate ') ||
        lower.startsWith('where is my ') ||
        lower.startsWith('look for ')
      ) {
        runVisualAnalysis('find', cleaned);
      } else {
        runVisualAnalysis('ask', cleaned);
      }
    },
    [confirmJarvisAndThenLetUserSpeak, latestResult, playHumanVoice, runVisualAnalysis]
  );

  // Process a completed audio clip from MediaRecorder
  // - In 'wake_check' mode: Detects if the user said "Jarvis", confirms it first, and then opens the microphone!
  // - In 'command' mode: Executes whatever the user spoke after "Jarvis" was confirmed!
  const handleRecordedClipComplete = useCallback(
    async (audioBlob: Blob, mimeType: string, modeAtStop: 'wake_check' | 'command') => {
      if (audioBlob.size < 250) {
        return;
      }

      if (modeAtStop === 'wake_check') {
        if (
          statusRef.current === 'listening' ||
          statusRef.current === 'jarvis_confirmed' ||
          statusRef.current === 'analyzing'
        ) {
          return;
        }
      } else {
        if (isTranscribingCommandRef.current) {
          return;
        }
      }

      if (Date.now() - lastProcessedCommandTimeRef.current < 1400) {
        return;
      }

      if (modeAtStop === 'wake_check') {
        isCheckingWakeRef.current = true;
        setIsCheckingWakeWordUI(true);
      } else {
        isTranscribingCommandRef.current = true;
        setStatus('analyzing');
        setStatusMessage('Understanding your spoken request...');
      }

      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Audio = reader.result as string;
        try {
          const res = await fetch('/api/vista/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64: base64Audio,
              mimeType,
              mode: modeAtStop,
            }),
          });
          const data = await res.json();
          if (modeAtStop === 'wake_check') {
            isCheckingWakeRef.current = false;
            setIsCheckingWakeWordUI(false);
          } else {
            isTranscribingCommandRef.current = false;
          }

          const text = (data.transcript || '').trim();
          const isJarvis = Boolean(data.isJarvisWakeWord || containsJarvisWakeWord(text));

          if (modeAtStop === 'wake_check') {
            // STEP 1: Did the user say "Jarvis"? First confirm "Jarvis" and then let the user speak!
            if (
              isJarvis &&
              statusRef.current !== 'listening' &&
              statusRef.current !== 'jarvis_confirmed'
            ) {
              confirmJarvisAndThenLetUserSpeak('auto');
            }
            return;
          }

          // STEP 2: Microphone was open for user's command
          if (!text) {
            setJarvisConfirmedBanner(null);
            setStatus(sourceModeRef.current === 'camera' ? 'camera_ready' : 'demo_ready');
            setStatusMessage(getDefaultReadyMessage());
            return;
          }

          const cleanedCommand = stripLeadingJarvis(text);
          if (!cleanedCommand) {
            // If the command clip only caught "Jarvis", keep the microphone open so the user can speak
            openMicrophoneForUserSpeech('auto', true);
            return;
          }

          setLiveSpeechDraft(cleanedCommand);
          setTextInputQuery(cleanedCommand);
          executeSpokenCommand(cleanedCommand);
        } catch {
          if (modeAtStop === 'wake_check') {
            isCheckingWakeRef.current = false;
            setIsCheckingWakeWordUI(false);
          } else {
            isTranscribingCommandRef.current = false;
            setJarvisConfirmedBanner(null);
            setStatus(sourceModeRef.current === 'camera' ? 'camera_ready' : 'demo_ready');
            setStatusMessage(getDefaultReadyMessage());
          }
        }
      };
      reader.readAsDataURL(audioBlob);
    },
    [
      confirmJarvisAndThenLetUserSpeak,
      executeSpokenCommand,
      getDefaultReadyMessage,
      openMicrophoneForUserSpeech,
    ]
  );

  // Initialize persistent hardware microphone + Adaptive Noise Floor VAD + Zero-Gap "Jarvis" Detector
  const initMicrophoneAndVAD = useCallback(async () => {
    if (micStreamRef.current) {
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
      return true;
    }
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      return false;
    }

    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      micStreamRef.current = micStream;
      setMicPermissionGranted(true);

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;
      audioCtx.resume().catch(() => {});

      const source = audioCtx.createMediaStreamSource(micStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const floatData = new Float32Array(analyser.fftSize);
      const byteData = new Uint8Array(analyser.fftSize);

      vadIntervalRef.current = window.setInterval(() => {
        if (!analyserRef.current) return;
        if (audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        }

        let peakAmplitude = 0;
        if (typeof analyserRef.current.getFloatTimeDomainData === 'function') {
          analyserRef.current.getFloatTimeDomainData(floatData);
          for (let i = 0; i < floatData.length; i++) {
            const abs = Math.abs(floatData[i]);
            if (abs > peakAmplitude) {
              peakAmplitude = abs;
            }
          }
        } else {
          analyserRef.current.getByteTimeDomainData(byteData);
          for (let i = 0; i < byteData.length; i++) {
            const abs = Math.abs(byteData[i] - 128) / 128;
            if (abs > peakAmplitude) {
              peakAmplitude = abs;
            }
          }
        }

        if (peakAmplitude > 0.0001) {
          hasAnalyserProducedSignalRef.current = true;
        }

        const normalizedVolume = Math.min(100, Math.round(peakAmplitude * 340));
        setMicVolumeLevel(normalizedVolume);

        // Adaptive ambient noise floor so quiet rooms detect soft "Jarvis" (0.010) and noisy rooms reject constant fan hum
        if (peakAmplitude < ambientNoiseFloorRef.current * 1.6) {
          ambientNoiseFloorRef.current =
            ambientNoiseFloorRef.current * 0.96 + peakAmplitude * 0.04;
        } else {
          ambientNoiseFloorRef.current =
            ambientNoiseFloorRef.current * 0.995 + peakAmplitude * 0.005;
        }
        const clampedFloor = Math.min(0.025, Math.max(0.004, ambientNoiseFloorRef.current));
        const adaptiveSpeechThreshold = Math.max(0.01, clampedFloor * 2.1);

        const now = Date.now();
        const isSpeakingNow = peakAmplitude >= adaptiveSpeechThreshold;

        // Pause microphone recording while VISTA is confirming "Jarvis", speaking a response, or analyzing
        if (
          statusRef.current === 'jarvis_confirmed' ||
          statusRef.current === 'speaking' ||
          statusRef.current === 'analyzing' ||
          isTranscribingCommandRef.current
        ) {
          if (
            isRecordingClipRef.current &&
            activeRecorderRef.current &&
            activeRecorderRef.current.state === 'recording'
          ) {
            try {
              activeRecorderRef.current.onstop = null;
              activeRecorderRef.current.stop();
              isRecordingClipRef.current = false;
            } catch {
              // ignore
            }
          }
          return;
        }

        // Keep a pre-buffered rolling recorder running with ZERO dead time whenever in Standby with Wake Word ON
        if (
          !isRecordingClipRef.current &&
          wakeWordEnabledRef.current &&
          (statusRef.current === 'camera_ready' || statusRef.current === 'demo_ready')
        ) {
          startFreshRecorderClip('wake_check');
          return;
        }

        if (isSpeakingNow) {
          const inWakeGracePeriod =
            clipModeRef.current === 'command' && now - wakeActivatedAtRef.current < 250;
          if (!inWakeGracePeriod) {
            if (voiceFramesInClipRef.current === 0) {
              firstVoiceTimeRef.current = now;
            }
            lastVoiceTimeRef.current = now;
            voiceFramesInClipRef.current += 1;
          }
        }

        if (isRecordingClipRef.current && activeRecorderRef.current) {
          const clipDuration = now - clipStartTimeRef.current;
          const silenceDuration = now - lastVoiceTimeRef.current;
          const sinceFirstVoice =
            firstVoiceTimeRef.current > 0 ? now - firstVoiceTimeRef.current : 0;

          if (clipModeRef.current === 'wake_check') {
            if (hasAnalyserProducedSignalRef.current) {
              // As soon as user speaks a word (>=1 voice frame) and pauses 380ms (or 1.15s after speech started), check for "Jarvis"!
              if (
                voiceFramesInClipRef.current >= 1 &&
                voiceFramesInClipRef.current <= 65 &&
                ((silenceDuration > 380 && clipDuration > 320) || sinceFirstVoice > 1150)
              ) {
                if (activeRecorderRef.current.state === 'recording') {
                  activeRecorderRef.current.stop();
                }
              }
              // Only silently rotate the rolling window at 2.4s if NO voice was heard (0 frames) or if continuous noise (>65 frames)
              else if (
                clipDuration > 2400 &&
                (voiceFramesInClipRef.current === 0 || voiceFramesInClipRef.current > 65)
              ) {
                startFreshRecorderClip('wake_check');
              }
              // Safety cap if voice started near the end of the window
              else if (clipDuration > 3500) {
                if (activeRecorderRef.current.state === 'recording') {
                  activeRecorderRef.current.stop();
                }
              }
            } else {
              // Fallback when browser AudioContext is suspended before first user click: check every 2.1s
              if (clipDuration > 2100 && !isCheckingWakeRef.current) {
                if (activeRecorderRef.current.state === 'recording') {
                  activeRecorderRef.current.stop();
                }
              }
            }
          } else if (clipModeRef.current === 'command') {
            // STEP 2 (After "Jarvis" was confirmed and microphone opened): Wait until user speaks and pauses 1.15s
            if (hasAnalyserProducedSignalRef.current) {
              if (
                (voiceFramesInClipRef.current >= 2 &&
                  silenceDuration > 1150 &&
                  clipDuration > 850) ||
                clipDuration > 9000
              ) {
                if (activeRecorderRef.current.state === 'recording') {
                  activeRecorderRef.current.stop();
                }
              }
            } else if (clipDuration > 4000) {
              if (activeRecorderRef.current.state === 'recording') {
                activeRecorderRef.current.stop();
              }
            }
          }
        }
      }, 30);

      return true;
    } catch (err) {
      console.warn('Microphone access error:', err);
      setMicPermissionGranted(false);
      return false;
    }
  }, [startFreshRecorderClip]);

  // Browser SpeechRecognition Accelerator for instant "Jarvis" -> Confirm -> Speak Command
  useEffect(() => {
    const SpeechRecognitionAPI =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance })
        .webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) return;

    let isUnmounted = false;
    let restartTimeout: number | null = null;

    const startBrowserSpeechAccelerator = () => {
      if (isUnmounted) return;
      if (
        statusRef.current === 'jarvis_confirmed' ||
        statusRef.current === 'speaking' ||
        statusRef.current === 'analyzing'
      ) {
        restartTimeout = window.setTimeout(startBrowserSpeechAccelerator, 350);
        return;
      }

      try {
        const recognition = new SpeechRecognitionAPI();
        speechRecRef.current = recognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 4;
        recognition.lang = 'en-US';
        consumedWakeResultIndexRef.current = -1;

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          if (
            statusRef.current === 'jarvis_confirmed' ||
            statusRef.current === 'speaking' ||
            statusRef.current === 'analyzing'
          ) {
            return;
          }

          const latestIdx = event.results.length - 1;
          if (latestIdx < 0) return;

          const latestItem = event.results[latestIdx];
          if (!latestItem || !latestItem[0]) return;

          const primaryPhrase = latestItem[0].transcript.trim();
          const isFinal = latestItem.isFinal;

          // Check all alternatives in the latest result for "Jarvis"
          let matchedWakeWord = false;
          for (let altIdx = 0; altIdx < latestItem.length; altIdx++) {
            const altText = latestItem[altIdx]?.transcript?.trim() || '';
            if (containsJarvisWakeWord(altText)) {
              matchedWakeWord = true;
              break;
            }
          }

          // STEP 1: While in Standby, saying "Jarvis" first CONFIRMS "Jarvis" and then lets the user speak!
          if (statusRef.current !== 'listening') {
            if (wakeWordEnabledRef.current && matchedWakeWord) {
              consumedWakeResultIndexRef.current = latestIdx;
              confirmJarvisAndThenLetUserSpeak('auto');
            }
            return;
          }

          // Ignore the same result index that triggered the wake word
          if (latestIdx === consumedWakeResultIndexRef.current) {
            return;
          }

          if (!primaryPhrase) return;

          // STEP 2: Microphone is now ACTIVE ('listening') after "Jarvis" confirmation — capture what the user says!
          const cleanedCommand = stripLeadingJarvis(primaryPhrase);
          if (!cleanedCommand) {
            return;
          }

          recognizedDraftRef.current = cleanedCommand;
          setLiveSpeechDraft(cleanedCommand);
          setTextInputQuery(cleanedCommand);

          if (webSpeechSilenceTimerRef.current) {
            window.clearTimeout(webSpeechSilenceTimerRef.current);
          }

          if (isFinal) {
            const cmd = cleanedCommand;
            recognizedDraftRef.current = '';
            if (
              isRecordingClipRef.current &&
              activeRecorderRef.current &&
              activeRecorderRef.current.state === 'recording'
            ) {
              try {
                activeRecorderRef.current.onstop = null;
                activeRecorderRef.current.stop();
                isRecordingClipRef.current = false;
              } catch {
                // ignore
              }
            }
            executeSpokenCommand(cmd);
          } else {
            webSpeechSilenceTimerRef.current = window.setTimeout(() => {
              const cmd = recognizedDraftRef.current.trim();
              if (cmd) {
                recognizedDraftRef.current = '';
                if (
                  isRecordingClipRef.current &&
                  activeRecorderRef.current &&
                  activeRecorderRef.current.state === 'recording'
                ) {
                  try {
                    activeRecorderRef.current.onstop = null;
                    activeRecorderRef.current.stop();
                    isRecordingClipRef.current = false;
                  } catch {
                    // ignore
                  }
                }
                executeSpokenCommand(cmd);
              }
            }, 1150);
          }
        };

        recognition.onerror = () => {
          // Zero-gap MediaRecorder + /api/vista/transcribe handles audio automatically
        };

        recognition.onend = () => {
          if (!isUnmounted) {
            restartTimeout = window.setTimeout(startBrowserSpeechAccelerator, 250);
          }
        };

        recognition.start();
      } catch {
        // Ignore if browser blocks SpeechRecognition; Pre-Buffered Recorder is active
      }
    };

    restartTimeout = window.setTimeout(startBrowserSpeechAccelerator, 200);

    return () => {
      isUnmounted = true;
      if (restartTimeout) window.clearTimeout(restartTimeout);
      if (webSpeechSilenceTimerRef.current) {
        window.clearTimeout(webSpeechSilenceTimerRef.current);
      }
      if (speechRecRef.current) {
        try {
          speechRecRef.current.onend = null;
          speechRecRef.current.abort();
        } catch {
          // ignore
        }
      }
    };
  }, [confirmJarvisAndThenLetUserSpeak, executeSpokenCommand]);

  // Start microphone & VAD automatically on mount, and resume AudioContext on any pointer/key interaction
  useEffect(() => {
    initMicrophoneAndVAD();

    const handleUserGesture = () => {
      initMicrophoneAndVAD();
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
    };

    window.addEventListener('pointerdown', handleUserGesture, { passive: true });
    window.addEventListener('keydown', handleUserGesture, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', handleUserGesture);
      window.removeEventListener('keydown', handleUserGesture);
      if (vadIntervalRef.current) window.clearInterval(vadIntervalRef.current);
      if (confirmStageTimeoutRef.current) window.clearTimeout(confirmStageTimeoutRef.current);
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [initMicrophoneAndVAD]);

  // Toggle manual microphone button (Start listening or finish & send)
  const handleMicrophoneButtonToggle = useCallback(
    async (intentMode: 'ask' | 'find' | 'auto' = 'auto') => {
      const ok = await initMicrophoneAndVAD();
      if (!ok) {
        soundFeedback.playError();
        setStatus('error');
        setStatusMessage('Microphone permission denied — allow mic access or type below');
        setActivePromptMode('ask');
        return;
      }

      if (statusRef.current === 'jarvis_confirmed') {
        // If user taps while VISTA is confirming "Jarvis", jump straight to listening for their speech
        stopSpeaking();
        openMicrophoneForUserSpeech(intentMode, true);
        return;
      }

      if (statusRef.current === 'listening') {
        if (recognizedDraftRef.current.trim()) {
          const draft = recognizedDraftRef.current.trim();
          recognizedDraftRef.current = '';
          if (
            isRecordingClipRef.current &&
            activeRecorderRef.current &&
            activeRecorderRef.current.state === 'recording'
          ) {
            try {
              activeRecorderRef.current.onstop = null;
              activeRecorderRef.current.stop();
              isRecordingClipRef.current = false;
            } catch {
              // ignore
            }
          }
          executeSpokenCommand(draft);
          return;
        }

        if (
          isRecordingClipRef.current &&
          activeRecorderRef.current &&
          activeRecorderRef.current.state === 'recording'
        ) {
          try {
            activeRecorderRef.current.stop();
          } catch {
            // ignore
          }
          return;
        }

        setJarvisConfirmedBanner(null);
        setStatus(sourceModeRef.current === 'camera' ? 'camera_ready' : 'demo_ready');
        setStatusMessage(getDefaultReadyMessage());
        return;
      }

      openMicrophoneForUserSpeech(intentMode, false);
    },
    [
      executeSpokenCommand,
      getDefaultReadyMessage,
      initMicrophoneAndVAD,
      openMicrophoneForUserSpeech,
      stopSpeaking,
    ]
  );

  // Handle pressing the large ASK button
  const handleAskButtonPress = () => {
    if (textInputQuery.trim() && status !== 'listening') {
      runVisualAnalysis('ask', textInputQuery.trim());
      return;
    }
    setActivePromptMode('ask');
    handleMicrophoneButtonToggle('ask');
  };

  // Handle pressing the large FIND button
  const handleFindButtonPress = () => {
    if (textInputQuery.trim() && status !== 'listening') {
      runVisualAnalysis('find', textInputQuery.trim());
      return;
    }
    setActivePromptMode('find');
    handleMicrophoneButtonToggle('find');
  };

  // Handle custom image upload for testing
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setUploadedImageUrl(reader.result as string);
      setImageLoadError(false);
      setSourceMode('upload');
      setStatus('demo_ready');
      setStatusMessage(getDefaultReadyMessage('upload'));
    };
    reader.readAsDataURL(file);
  };

  // Global keyboard shortcuts for blind / low-vision accessibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === '1' || e.key.toLowerCase() === 'd') {
        e.preventDefault();
        runVisualAnalysis('describe');
      } else if (e.key === '2' || e.key.toLowerCase() === 'a') {
        e.preventDefault();
        handleAskButtonPress();
      } else if (e.key === '3' || e.key.toLowerCase() === 'r') {
        e.preventDefault();
        runVisualAnalysis('read');
      } else if (e.key === '4' || e.key.toLowerCase() === 'f') {
        e.preventDefault();
        handleFindButtonPress();
      } else if (e.key === ' ') {
        e.preventDefault();
        handleMicrophoneButtonToggle(activePromptMode || 'auto');
      } else if (e.key === 'Escape') {
        stopSpeaking();
        setStatus(sourceModeRef.current === 'camera' ? 'camera_ready' : 'demo_ready');
        setStatusMessage(getDefaultReadyMessage());
        setActivePromptMode(null);
        setShowShortcutsModal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // Cycle speech rate
  const cycleSpeechRate = () => {
    const rates = [0.9, 1.0, 1.25, 1.5];
    const nextIdx = (rates.indexOf(speechRate) + 1) % rates.length;
    setSpeechRate(rates[nextIdx]);
  };

  // Status visual & icon configuration tailored to Light & Dark Studio themes
  const getStatusVisuals = () => {
    switch (status) {
      case 'jarvis_confirmed':
        return {
          icon: (
            <CheckCircle2
              className="w-5 h-5 text-emerald-600 dark:text-emerald-400 animate-bounce shrink-0"
              aria-hidden="true"
            />
          ),
          containerClass: isDarkTheme
            ? 'border-emerald-500/80 bg-emerald-950/45 text-white'
            : 'border-emerald-400 bg-emerald-50/95 text-slate-900',
          kickerClass: isDarkTheme ? 'text-emerald-300' : 'text-emerald-700',
          labelPrefix: 'Step 1 Complete · "Jarvis" Confirmed',
        };
      case 'listening':
        return {
          icon: <Mic className="w-5 h-5 text-rose-600 dark:text-rose-400 animate-pulse shrink-0" aria-hidden="true" />,
          containerClass: isDarkTheme
            ? 'border-rose-500/80 bg-rose-950/40 text-white'
            : 'border-rose-300 bg-rose-50/90 text-slate-900',
          kickerClass: isDarkTheme ? 'text-rose-300' : 'text-rose-700',
          labelPrefix: jarvisConfirmedBanner
            ? 'Step 2 · "Jarvis" Confirmed — Your Turn to Speak'
            : 'Microphone Active · Listening Now',
        };
      case 'analyzing':
        return {
          icon: (
            <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin shrink-0" aria-hidden="true" />
          ),
          containerClass: isDarkTheme
            ? 'border-blue-500/70 bg-blue-950/30 text-white'
            : 'border-blue-200 bg-blue-50/80 text-slate-900',
          kickerClass: isDarkTheme ? 'text-blue-300' : 'text-blue-700',
          labelPrefix: 'Analyzing Scene',
        };
      case 'speaking':
        return {
          icon: (
            <Volume2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 animate-pulse shrink-0" aria-hidden="true" />
          ),
          containerClass: isDarkTheme
            ? 'border-indigo-500/70 bg-indigo-950/30 text-white'
            : 'border-indigo-200 bg-indigo-50/80 text-slate-900',
          kickerClass: isDarkTheme ? 'text-indigo-300' : 'text-indigo-700',
          labelPrefix: 'Natural Voice Output',
        };
      case 'error':
        return {
          icon: <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />,
          containerClass: isDarkTheme
            ? 'border-amber-500/70 bg-amber-950/30 text-white'
            : 'border-amber-300 bg-amber-50 text-slate-900',
          kickerClass: isDarkTheme ? 'text-amber-300' : 'text-amber-800',
          labelPrefix: 'System Notice',
        };
      default:
        return {
          icon: <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />,
          containerClass: isDarkTheme
            ? 'border-slate-800 bg-slate-900/90 text-white'
            : 'border-slate-200/90 bg-white text-slate-900 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.05)]',
          kickerClass: isDarkTheme ? 'text-emerald-400' : 'text-emerald-700',
          labelPrefix:
            wakeWordEnabled && micPermissionGranted
              ? isCheckingWakeWordUI
                ? 'Checking Wake Word "Jarvis"...'
                : 'Hands-Free Standby · Say "Jarvis"'
              : 'System Ready',
        };
    }
  };

  const statusVisual = getStatusVisuals();
  const currentDemoSuggestions = activeDemoScene;

  // Theme surface helpers
  const pageBg = isDarkTheme ? 'bg-[#0B0F17] text-slate-100' : 'bg-[#F8FAFC] text-slate-900';
  const headerBg = isDarkTheme
    ? 'bg-[#0B0F17]/90 border-slate-800/90 text-slate-100'
    : 'bg-white/90 border-slate-200/80 text-slate-900';
  const surfaceCard = isDarkTheme
    ? 'bg-slate-900/90 border-slate-800 text-slate-100'
    : 'bg-white border-slate-200/90 text-slate-900 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.05)]';
  const mutedText = isDarkTheme ? 'text-slate-400' : 'text-slate-500';
  const secondaryText = isDarkTheme ? 'text-slate-300' : 'text-slate-600';

  return (
    <div className={`min-h-screen flex flex-col justify-between transition-colors duration-200 ${pageBg}`}>
      {/* Hidden File Input for Custom Photo Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
        className="sr-only"
        aria-label="Upload a sample photo to analyze"
      />

      {/* TOP NAVIGATION BAR — Strict 3-Zone Contract */}
      <header
        className={`sticky top-0 z-30 h-16 px-4 sm:px-8 backdrop-blur-md border-b flex items-center justify-between transition-colors ${headerBg}`}
      >
        {/* Zone 1: Single Text Element Brand Wordmark */}
        <a
          href="#main-console"
          className="font-display text-xl font-bold tracking-tight whitespace-nowrap shrink-0"
        >
          VISTA
        </a>

        {/* Zone 2: Clean Single-Line Navigation / Input Mode Links */}
        <nav
          aria-label="Visual Input Source and Help"
          className="hidden md:flex items-center gap-7 text-sm font-medium"
        >
          <button
            type="button"
            onClick={() => setSourceMode('camera')}
            className={`py-1 whitespace-nowrap transition-colors ${
              sourceMode === 'camera'
                ? 'text-blue-600 dark:text-blue-400 font-semibold underline underline-offset-8 decoration-2'
                : `${secondaryText} hover:text-blue-600`
            }`}
          >
            Live Camera
          </button>
          <button
            type="button"
            onClick={() => {
              setSourceMode('demo');
              setImageLoadError(false);
            }}
            className={`py-1 whitespace-nowrap transition-colors ${
              sourceMode === 'demo'
                ? 'text-blue-600 dark:text-blue-400 font-semibold underline underline-offset-8 decoration-2'
                : `${secondaryText} hover:text-blue-600`
            }`}
          >
            Demo Scenes
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={`py-1 whitespace-nowrap transition-colors ${
              sourceMode === 'upload'
                ? 'text-blue-600 dark:text-blue-400 font-semibold underline underline-offset-8 decoration-2'
                : `${secondaryText} hover:text-blue-600`
            }`}
          >
            Upload Image
          </button>
          <button
            type="button"
            onClick={() => setShowShortcutsModal((prev) => !prev)}
            className={`py-1 whitespace-nowrap transition-colors ${secondaryText} hover:text-blue-600`}
          >
            Voice &amp; Keys
          </button>
        </nav>

        {/* Zone 3: Primary Audio & Appearance Controls */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          <button
            type="button"
            onClick={() => setIsDarkTheme((prev) => !prev)}
            aria-label={isDarkTheme ? 'Switch to Studio Light theme' : 'Switch to Dark theme'}
            className={`min-h-[40px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              isDarkTheme
                ? 'bg-slate-800 border-slate-700 text-slate-200 hover:border-slate-500'
                : 'bg-slate-100/80 border-slate-200 text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            {isDarkTheme ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                <span className="hidden sm:inline">Light</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
                <span className="hidden sm:inline">Dark</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={cycleSpeechRate}
            aria-label={`Speech rate ${speechRate}x. Activate to change reading speed.`}
            className={`min-h-[40px] px-3 py-2 rounded-xl border text-xs font-mono-tabular font-semibold transition-colors whitespace-nowrap shrink-0 ${
              isDarkTheme
                ? 'bg-slate-800 border-slate-700 text-slate-200 hover:border-slate-500'
                : 'bg-slate-100/80 border-slate-200 text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            {speechRate}x
          </button>

          <button
            type="button"
            onClick={() => {
              const next = !autoSpeak;
              setAutoSpeak(next);
              soundFeedback.enabled = next;
              if (!next) stopSpeaking();
            }}
            aria-pressed={autoSpeak}
            aria-label={
              autoSpeak
                ? 'Spoken audio enabled. Tap to mute.'
                : 'Spoken audio muted. Tap to unmute.'
            }
            className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              autoSpeak
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-xs'
                : isDarkTheme
                  ? 'bg-slate-800 text-slate-300 border border-slate-700'
                  : 'bg-slate-200 text-slate-700'
            }`}
          >
            {autoSpeak ? (
              <>
                <Volume2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Voice On</span>
              </>
            ) : (
              <>
                <VolumeX className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Muted</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* MAIN ARCHITECTURAL WORKSPACE */}
      <main
        id="main-console"
        className="flex-1 w-full max-w-[1360px] mx-auto px-4 sm:px-8 py-6 sm:py-8 flex flex-col gap-6"
      >
        {/* EDITORIAL HERO HEADER: "Point. Ask. Understand." + Safety Notice */}
        <section
          aria-label="Application overview and safety notice"
          className={`flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b ${
            isDarkTheme ? 'border-slate-800/80' : 'border-slate-200/90'
          }`}
        >
          <div>
            <p className="text-xs sm:text-sm font-semibold text-blue-600 dark:text-blue-400 tracking-wide">
              Visual Intelligence &amp; Scene Translation Assistant
            </p>
            <h1
              className="font-display text-2xl sm:text-4xl font-bold tracking-tight mt-1"
              style={{ textWrap: 'balance' }}
            >
              Point. Ask. Understand.
            </h1>
          </div>

          <p className={`text-xs sm:text-sm max-w-xl leading-relaxed ${secondaryText}`}>
            <strong className="font-semibold text-slate-900 dark:text-slate-100">
              Assistive Prototype Notice:
            </strong>{' '}
            VISTA is a visual companion and not a replacement for a cane, guide dog, caregiver, or
            mobility aid. It does not guarantee physical safety, detect every obstacle, or measure
            exact distance.
          </p>
        </section>

        {/* CORE SPLIT WORKSPACE: Left (Optical Viewfinder + Status + Transcript) | Right (Tactile Actions + Jarvis Mic) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* LEFT COLUMN (7 cols on desktop): STATUS BAR + OPTICAL VIEWFINDER + SPOKEN TRANSCRIPT */}
          <section
            aria-label="Camera preview and spoken response transcript"
            className="lg:col-span-7 flex flex-col gap-5"
          >
            {/* 7. CLEAR STATUS INDICATOR BAR */}
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={`w-full min-h-[60px] px-5 py-3.5 rounded-2xl border flex items-center justify-between gap-3 transition-colors ${statusVisual.containerClass}`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                {statusVisual.icon}
                <div className="min-w-0">
                  <span
                    className={`text-xs font-semibold tracking-wide block ${statusVisual.kickerClass}`}
                  >
                    {statusVisual.labelPrefix}
                  </span>
                  <p className="text-sm sm:text-base font-semibold truncate mt-0.5">
                    {statusMessage}
                  </p>
                </div>
              </div>

              {/* Contextual Action Button */}
              <div className="flex items-center gap-2 shrink-0">
                {status === 'listening' && (
                  <button
                    type="button"
                    onClick={() => handleMicrophoneButtonToggle(activePromptMode || 'auto')}
                    aria-label="Finish speaking and analyze now"
                    className="min-h-[40px] px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shadow-xs"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                    <span>Send Speech</span>
                  </button>
                )}

                {status === 'speaking' && (
                  <button
                    type="button"
                    onClick={stopSpeaking}
                    aria-label="Stop speaking current response"
                    className="min-h-[40px] px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shadow-xs"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                    <span>Stop Audio</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    if (sourceMode === 'camera') {
                      setSourceMode('demo');
                    } else {
                      setSourceMode('camera');
                    }
                  }}
                  className={`min-h-[40px] px-3.5 py-2 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap ${
                    isDarkTheme
                      ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-100'
                      : 'bg-slate-100 hover:bg-slate-200/80 border-slate-200/90 text-slate-800'
                  }`}
                >
                  {sourceMode === 'camera' ? 'Switch to Demo Scenes' : 'Use Live Camera'}
                </button>
              </div>
            </div>

            {/* 1. LIVE OPTICAL CAMERA PREVIEW (OR DEMO SCENE / UPLOADED PHOTO) */}
            <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-950 border border-slate-200/80 dark:border-slate-800 shadow-[0_10px_30px_-10px_rgba(15,23,42,0.12)]">
              {sourceMode === 'camera' ? (
                <>
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    onPlay={() => setIsVideoStreaming(true)}
                    aria-label="Live camera preview"
                    className="w-full h-full object-cover"
                  />
                  {!isVideoStreaming && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 p-6 text-center">
                      <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center mb-3">
                        <Camera
                          className="w-6 h-6 text-blue-400 animate-pulse"
                          aria-hidden="true"
                        />
                      </div>
                      <p className="text-sm sm:text-base font-semibold text-white">
                        Initializing camera stream...
                      </p>
                      <p className="text-xs text-slate-300 mt-1 max-w-sm">
                        Allow camera access in your browser prompt, or switch to Demo Scenes to
                        explore immediately.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {!imageLoadError ? (
                    <img
                      ref={previewImgRef}
                      src={
                        sourceMode === 'upload' && uploadedImageUrl
                          ? uploadedImageUrl
                          : activeDemoScene.imageUrl
                      }
                      alt={
                        sourceMode === 'upload'
                          ? 'User uploaded scene for visual analysis'
                          : activeDemoScene.altText
                      }
                      referrerPolicy="no-referrer"
                      onError={() => setImageLoadError(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-gradient-to-br from-slate-900 to-slate-800 text-center">
                      <Camera className="w-10 h-10 text-blue-400 mb-3" aria-hidden="true" />
                      <p className="text-base font-semibold text-white">{activeDemoScene.title}</p>
                      <p className="text-xs text-slate-300 max-w-md mt-1">
                        {activeDemoScene.altText}
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* Subtle Architectural Framing Reticle */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-5 border border-white/20 rounded-xl flex items-center justify-center"
              >
                <div
                  className={`w-10 h-10 rounded-full border transition-transform duration-200 ${
                    status === 'analyzing'
                      ? 'border-blue-400 scale-125 animate-ping'
                      : 'border-white/35 scale-100'
                  }`}
                />
              </div>

              {/* Top Measured Glass Scrim Overlay */}
              <div className="absolute top-0 inset-x-0 p-3.5 sm:p-4 bg-gradient-to-b from-black/75 via-black/35 to-transparent flex items-center justify-between gap-2">
                <div className="text-xs sm:text-sm font-medium text-white flex items-center gap-2 truncate">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    {sourceMode === 'camera'
                      ? `Live Camera · ${facingMode === 'environment' ? 'Rear Lens' : 'Front Lens'}`
                      : sourceMode === 'upload'
                        ? 'Custom Uploaded Photo'
                        : activeDemoScene.title}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {sourceMode === 'camera' && (
                    <button
                      type="button"
                      onClick={() =>
                        setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
                      }
                      aria-label="Flip between front and rear camera"
                      className="min-h-[36px] px-3 py-1.5 rounded-lg bg-black/55 hover:bg-black/75 backdrop-blur-md text-white border border-white/20 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Flip Lens</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Upload custom image frame"
                    className="min-h-[36px] px-3 py-1.5 rounded-lg bg-black/55 hover:bg-black/75 backdrop-blur-md text-white border border-white/20 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Upload Photo</span>
                  </button>
                </div>
              </div>

              {/* Demo Scene Selector Bar */}
              {sourceMode !== 'camera' && (
                <div className="absolute bottom-0 inset-x-0 p-3.5 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
                  <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
                    {DEMO_SCENES.map((scene) => {
                      const isSelected =
                        sourceMode === 'demo' && activeDemoScene.id === scene.id;
                      return (
                        <button
                          key={scene.id}
                          type="button"
                          onClick={() => {
                            setSourceMode('demo');
                            setActiveDemoScene(scene);
                            setImageLoadError(false);
                          }}
                          aria-pressed={isSelected}
                          className={`min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                            isSelected
                              ? 'bg-white text-slate-950 shadow-xs'
                              : 'bg-black/60 text-slate-200 border border-white/20 hover:bg-black/80'
                          }`}
                        >
                          {scene.shortLabel}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Camera Permission Notice if Present */}
            {cameraNotice && (
              <div
                role="region"
                aria-label="Camera mode notice"
                className={`px-4 py-3 rounded-xl border text-xs sm:text-sm flex items-center justify-between gap-3 ${surfaceCard}`}
              >
                <span className={secondaryText}>{cameraNotice}</span>
                <button
                  type="button"
                  onClick={() => startCamera()}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                >
                  Retry Camera
                </button>
              </div>
            )}

            {/* 8. VISIBLE TEXT TRANSCRIPT OF LATEST AI RESPONSE */}
            <section
              aria-label="Latest AI response transcript"
              aria-live="polite"
              className={`w-full p-5 sm:p-6 rounded-2xl border flex flex-col gap-3.5 ${surfaceCard}`}
            >
              {/* Clean Unboxed Metadata Row (Zero-Pill Discipline) */}
              <div
                className={`flex flex-wrap items-center justify-between gap-2 text-xs border-b pb-3 ${
                  isDarkTheme ? 'border-slate-800' : 'border-slate-100'
                }`}
              >
                <div className={`flex flex-wrap items-center gap-2 font-medium ${mutedText}`}>
                  <span className="text-blue-600 dark:text-blue-400 font-semibold capitalize">
                    {latestResult.mode} Mode
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-tabular">{latestResult.timestamp}</span>
                  {latestResult.query && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className={secondaryText}>
                        &ldquo;{latestResult.query}&rdquo;
                      </span>
                    </>
                  )}
                  {latestResult.foundStatus === 'found' && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                        Located in View
                      </span>
                    </>
                  )}
                  {latestResult.foundStatus === 'not_found' && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-amber-600 dark:text-amber-400 font-semibold">
                        Not in Current View
                      </span>
                    </>
                  )}
                </div>

                {/* Replay Audio Button */}
                <button
                  type="button"
                  onClick={() =>
                    playHumanVoice(
                      showFullReadText && latestResult.fullText
                        ? latestResult.fullText
                        : latestResult.spokenResponse,
                      showFullReadText ? null : latestResult.audioBase64,
                      true
                    )
                  }
                  aria-label="Replay spoken response aloud"
                  className={`min-h-[36px] px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                    isDarkTheme
                      ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-100'
                      : 'bg-slate-50 hover:bg-slate-100 border-slate-200/90 text-slate-700'
                  }`}
                >
                  <Play
                    className="w-3.5 h-3.5 fill-current text-blue-600 dark:text-blue-400"
                    aria-hidden="true"
                  />
                  <span>Replay Audio</span>
                </button>
              </div>

              {/* Primary Spoken Transcript Text */}
              <p className="text-base sm:text-lg font-medium leading-relaxed">
                {latestResult.spokenResponse}
              </p>

              {/* READ Mode: Offer to Read Full Text if Summarized */}
              {latestResult.hasMoreText && latestResult.fullText && (
                <div
                  className={`pt-3 border-t flex flex-col gap-3 ${
                    isDarkTheme ? 'border-slate-800' : 'border-slate-100'
                  }`}
                >
                  {showFullReadText ? (
                    <div
                      className={`p-4 rounded-xl border ${
                        isDarkTheme
                          ? 'bg-slate-950 border-slate-800 text-slate-200'
                          : 'bg-slate-50 border-slate-200/80 text-slate-800'
                      }`}
                    >
                      <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">
                        Complete Verbatim Text
                      </p>
                      <p className="text-sm sm:text-base leading-relaxed whitespace-pre-line">
                        {latestResult.fullText}
                      </p>
                    </div>
                  ) : null}

                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowFullReadText(true);
                        playHumanVoice(latestResult.fullText, null, true);
                      }}
                      className="min-h-[42px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm inline-flex items-center gap-2 whitespace-nowrap shadow-xs"
                    >
                      <BookOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>Read Full Text Aloud</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Detected Key Items Metadata (Unboxed Text with · Separators) */}
              {latestResult.keyItems.length > 0 && (
                <div
                  className={`pt-2.5 border-t text-xs flex flex-wrap items-center gap-2 ${
                    isDarkTheme
                      ? 'border-slate-800/80 text-slate-400'
                      : 'border-slate-100 text-slate-500'
                  }`}
                >
                  <span className="font-semibold">Detected in frame:</span>
                  {latestResult.keyItems.map((item, idx) => (
                    <React.Fragment key={`${item}-${idx}`}>
                      {idx > 0 && <span aria-hidden="true">·</span>}
                      <span>{item}</span>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </section>
          </section>

          {/* RIGHT COLUMN (5 cols on desktop): TACTILE COMMAND TILES + JARVIS VOICE DOCK + QUICK PROMPTS */}
          <section
            aria-label="Primary assistive actions"
            className="lg:col-span-5 flex flex-col gap-5"
          >
            {/* 2x2 ARCHITECTURAL COMMAND PAD: DESCRIBE, ASK, READ, FIND */}
            <div className="grid grid-cols-2 gap-3.5 sm:gap-4">
              {/* 2. PRIMARY FOCAL ANCHOR: LARGE "DESCRIBE" BUTTON */}
              <button
                type="button"
                disabled={status === 'analyzing'}
                onClick={() => runVisualAnalysis('describe')}
                aria-label="Describe scene. Captures current camera frame and describes people, doors, furniture, signs, and layout."
                className="min-h-[124px] sm:min-h-[138px] p-5 rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white shadow-[0_8px_24px_-6px_rgba(37,99,235,0.45)] flex flex-col justify-between items-start text-left transition-all disabled:opacity-60"
              >
                <div className="w-full flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
                    <Eye className="w-5 h-5 text-white" aria-hidden="true" />
                  </div>
                  <span className="text-xs font-mono-tabular font-medium text-blue-100">
                    Key 1
                  </span>
                </div>
                <div className="mt-3">
                  <span className="font-display text-lg sm:text-xl font-bold tracking-tight block whitespace-nowrap">
                    DESCRIBE
                  </span>
                  <span className="text-xs text-blue-100 block mt-0.5">
                    Scene layout &amp; objects
                  </span>
                </div>
              </button>

              {/* 3. LARGE "ASK" BUTTON */}
              <button
                type="button"
                disabled={status === 'analyzing'}
                onClick={handleAskButtonPress}
                aria-pressed={activePromptMode === 'ask'}
                aria-label="Ask a question about what the camera sees. Activates microphone or question selector."
                className={`min-h-[124px] sm:min-h-[138px] p-5 rounded-2xl border active:scale-[0.99] flex flex-col justify-between items-start text-left transition-all disabled:opacity-60 ${
                  activePromptMode === 'ask'
                    ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-500 text-blue-950 dark:text-white'
                    : `${surfaceCard} hover:border-blue-400 dark:hover:border-blue-500`
                }`}
              >
                <div className="w-full flex items-center justify-between">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      isDarkTheme ? 'bg-sky-500/15 text-sky-400' : 'bg-sky-50 text-sky-600'
                    }`}
                  >
                    <HelpCircle className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <span className={`text-xs font-mono-tabular font-medium ${mutedText}`}>
                    Key 2
                  </span>
                </div>
                <div className="mt-3">
                  <span className="font-display text-lg sm:text-xl font-bold tracking-tight block whitespace-nowrap">
                    ASK
                  </span>
                  <span className={`text-xs block mt-0.5 ${secondaryText}`}>
                    Question about view
                  </span>
                </div>
              </button>

              {/* 5. LARGE "READ" BUTTON */}
              <button
                type="button"
                disabled={status === 'analyzing'}
                onClick={() => runVisualAnalysis('read')}
                aria-label="Read visible text aloud. Identifies signs, labels, menus, or documents in the camera frame."
                className={`min-h-[124px] sm:min-h-[138px] p-5 rounded-2xl border active:scale-[0.99] flex flex-col justify-between items-start text-left transition-all disabled:opacity-60 ${surfaceCard} hover:border-blue-400 dark:hover:border-blue-500`}
              >
                <div className="w-full flex items-center justify-between">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      isDarkTheme
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-emerald-50 text-emerald-600'
                    }`}
                  >
                    <BookOpen className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <span className={`text-xs font-mono-tabular font-medium ${mutedText}`}>
                    Key 3
                  </span>
                </div>
                <div className="mt-3">
                  <span className="font-display text-lg sm:text-xl font-bold tracking-tight block whitespace-nowrap">
                    READ
                  </span>
                  <span className={`text-xs block mt-0.5 ${secondaryText}`}>
                    Signs, menus &amp; labels
                  </span>
                </div>
              </button>

              {/* 4. LARGE "FIND" BUTTON */}
              <button
                type="button"
                disabled={status === 'analyzing'}
                onClick={handleFindButtonPress}
                aria-pressed={activePromptMode === 'find'}
                aria-label="Find a specific object in the camera view. Activates microphone or object selector."
                className={`min-h-[124px] sm:min-h-[138px] p-5 rounded-2xl border active:scale-[0.99] flex flex-col justify-between items-start text-left transition-all disabled:opacity-60 ${
                  activePromptMode === 'find'
                    ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-500 text-blue-950 dark:text-white'
                    : `${surfaceCard} hover:border-blue-400 dark:hover:border-blue-500`
                }`}
              >
                <div className="w-full flex items-center justify-between">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      isDarkTheme
                        ? 'bg-indigo-500/15 text-indigo-400'
                        : 'bg-indigo-50 text-indigo-600'
                    }`}
                  >
                    <Search className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <span className={`text-xs font-mono-tabular font-medium ${mutedText}`}>
                    Key 4
                  </span>
                </div>
                <div className="mt-3">
                  <span className="font-display text-lg sm:text-xl font-bold tracking-tight block whitespace-nowrap">
                    FIND
                  </span>
                  <span className={`text-xs block mt-0.5 ${secondaryText}`}>
                    Locate an object
                  </span>
                </div>
              </button>
            </div>

            {/* 6. DEDICATED MICROPHONE & HANDS-FREE "JARVIS" VOICE DOCK */}
            <div className={`p-5 rounded-2xl border flex flex-col gap-4 ${surfaceCard}`}>
              {/* Step-by-Step "Jarvis Confirmed" Live Banner */}
              {jarvisConfirmedBanner && (
                <div
                  role="status"
                  aria-live="assertive"
                  className={`px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 ${
                    status === 'jarvis_confirmed'
                      ? isDarkTheme
                        ? 'bg-emerald-950/60 border-emerald-500/80 text-emerald-200'
                        : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                      : isDarkTheme
                        ? 'bg-rose-950/60 border-rose-500/80 text-rose-200'
                        : 'bg-rose-50 border-rose-300 text-rose-900'
                  }`}
                >
                  <span className="truncate">{jarvisConfirmedBanner}</span>
                  <span className="font-mono-tabular shrink-0">
                    {status === 'jarvis_confirmed' ? 'Step 1/2' : 'Step 2/2'}
                  </span>
                </div>
              )}

              <button
                type="button"
                disabled={status === 'analyzing'}
                onClick={() => handleMicrophoneButtonToggle(activePromptMode || 'auto')}
                aria-pressed={status === 'listening' || status === 'jarvis_confirmed'}
                aria-label={
                  status === 'jarvis_confirmed'
                    ? 'Jarvis confirmed. Confirming before opening microphone, or tap to speak immediately.'
                    : status === 'listening'
                      ? 'Microphone active and listening. Say what you need, or tap to send now.'
                      : 'Microphone button. Say Jarvis to activate hands-free, or tap here to speak.'
                }
                className={`w-full min-h-[84px] px-5 py-4 rounded-xl border flex flex-col justify-between gap-2.5 transition-all active:scale-[0.99] disabled:opacity-60 ${
                  status === 'jarvis_confirmed'
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-500 shadow-[0_8px_24px_-6px_rgba(5,150,105,0.45)]'
                    : status === 'listening'
                      ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-500 shadow-[0_8px_24px_-6px_rgba(225,29,72,0.45)]'
                      : isDarkTheme
                        ? 'bg-slate-950 hover:bg-slate-800/90 text-white border-slate-700'
                        : 'bg-slate-900 hover:bg-slate-800 text-white border-slate-900 shadow-xs'
                }`}
              >
                <div className="w-full flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3.5 min-w-0 text-left">
                    <div
                      className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                        status === 'jarvis_confirmed'
                          ? 'bg-white text-emerald-600'
                          : status === 'listening'
                            ? 'bg-white text-rose-600'
                            : 'bg-blue-600 text-white'
                      }`}
                    >
                      {status === 'jarvis_confirmed' ? (
                        <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
                      ) : status === 'listening' ? (
                        <MicOff className="w-5 h-5" aria-hidden="true" />
                      ) : (
                        <Mic className="w-5 h-5" aria-hidden="true" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <span className="font-display text-base sm:text-lg font-bold tracking-tight block whitespace-nowrap">
                        {status === 'jarvis_confirmed'
                          ? '✓ "JARVIS" CONFIRMED — ANSWERING...'
                          : status === 'listening'
                            ? 'MIC ON — SPEAK YOUR REQUEST NOW'
                            : 'MICROPHONE · SAY "JARVIS"'}
                      </span>
                      <span className="text-xs text-slate-100 block truncate mt-0.5">
                        {status === 'jarvis_confirmed'
                          ? '"Yes, I\'m listening. Go ahead..." (Opening mic next)'
                          : liveSpeechDraft
                            ? `Heard: "${liveSpeechDraft}"`
                            : status === 'listening'
                              ? 'Jarvis confirmed · Speak your command now, then pause'
                              : isCheckingWakeWordUI
                                ? 'Checking spoken word for "Jarvis"...'
                                : '1. Say "Jarvis" (VISTA confirms) · 2. Then speak your request'}
                      </span>
                    </div>
                  </div>

                  <span className="hidden sm:inline-block text-xs font-mono-tabular font-medium text-slate-100 shrink-0">
                    {status === 'jarvis_confirmed'
                      ? 'Confirming'
                      : status === 'listening'
                        ? 'Tap to Send'
                        : 'Spacebar'}
                  </span>
                </div>

                {/* Live Hardware Microphone Audio Level Bar */}
                <div className="w-full h-1.5 bg-white/15 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-75 rounded-full ${
                      status === 'listening' || status === 'jarvis_confirmed'
                        ? 'bg-white'
                        : 'bg-emerald-400'
                    }`}
                    style={{ width: `${Math.max(4, micVolumeLevel)}%` }}
                  />
                </div>
              </button>

              {/* Hands-Free Wake Word ("Jarvis") Row */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Radio
                    className={`w-4 h-4 shrink-0 ${
                      wakeWordEnabled && micPermissionGranted
                        ? 'text-emerald-600 dark:text-emerald-400 animate-pulse'
                        : mutedText
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">
                      Wake Word: &ldquo;Jarvis&rdquo; (Confirms First, Then Listens)
                    </p>
                    <p className={`text-xs truncate ${mutedText}`}>
                      {isCheckingWakeWordUI
                        ? 'Verifying if you said "Jarvis"...'
                        : micPermissionGranted
                          ? 'Say "Jarvis" — VISTA confirms first, then lets you speak'
                          : 'Tap anywhere once if browser paused microphone audio'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={status === 'analyzing' || status === 'jarvis_confirmed'}
                    onClick={ async () => {
                      await initMicrophoneAndVAD();
                      confirmJarvisAndThenLetUserSpeak(activePromptMode || 'auto');
                    }}
                    aria-label="Simulate saying Jarvis to trigger confirmation and open microphone"
                    className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
                      isDarkTheme
                        ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                        : 'bg-slate-100 hover:bg-slate-200/80 text-slate-700 border-slate-200'
                    }`}
                  >
                    Trigger &ldquo;Jarvis&rdquo;
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const next = !wakeWordEnabled;
                      setWakeWordEnabled(next);
                      initMicrophoneAndVAD();
                      if (next) {
                        soundFeedback.playWakeWord();
                      }
                    }}
                    aria-pressed={wakeWordEnabled}
                    className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 ${
                      wakeWordEnabled
                        ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                        : isDarkTheme
                          ? 'bg-slate-800 text-slate-300 border-slate-700'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}
                  >
                    {wakeWordEnabled ? 'Wake ON' : 'Wake OFF'}
                  </button>
                </div>
              </div>
            </div>

            {/* CONTEXTUAL ASK / FIND QUICK-PHRASE & TEXT INPUT PANEL */}
            <div
              role="region"
              aria-label="Quick voice prompts and text question fallback"
              className={`p-5 rounded-2xl border flex flex-col gap-4 ${surfaceCard}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">
                  {activePromptMode === 'find'
                    ? 'Find Object in Scene'
                    : 'Quick Questions & Object Search'}
                </h2>
                {activePromptMode && (
                  <button
                    type="button"
                    onClick={() => setActivePromptMode(null)}
                    className={`text-xs font-medium hover:underline whitespace-nowrap ${mutedText}`}
                  >
                    Reset
                  </button>
                )}
              </div>

              {/* Suggested 1-Tap Prompts tailored to the active mode or scene */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(activePromptMode === 'find'
                  ? [
                      ...currentDemoSuggestions.suggestedFinds,
                      'Find the chair',
                      'Find the sign',
                      'Find my glasses',
                    ]
                  : [
                      ...currentDemoSuggestions.suggestedQuestions,
                      ...currentDemoSuggestions.suggestedFinds.slice(0, 1),
                    ]
                )
                  .slice(0, 4)
                  .map((promptText) => {
                    const isFindPrompt = promptText.toLowerCase().startsWith('find ');
                    const targetMode: VistaMode =
                      activePromptMode === 'find' || isFindPrompt ? 'find' : 'ask';
                    return (
                      <button
                        key={promptText}
                        type="button"
                        disabled={status === 'analyzing'}
                        onClick={() => runVisualAnalysis(targetMode, promptText)}
                        className={`min-h-[42px] px-3.5 py-2 rounded-xl border text-left text-xs font-medium flex items-center justify-between gap-2 transition-colors ${
                          isDarkTheme
                            ? 'bg-slate-950/70 hover:bg-slate-800 border-slate-800 text-slate-200 hover:border-blue-500'
                            : 'bg-slate-50/90 hover:bg-blue-50/50 border-slate-200/80 text-slate-700 hover:border-blue-300 hover:text-slate-900'
                        }`}
                      >
                        <span className="truncate">{promptText}</span>
                        <ArrowUpRight className="w-3.5 h-3.5 shrink-0 opacity-50" aria-hidden="true" />
                      </button>
                    );
                  })}
              </div>

              {/* Accessible Keyboard / Text Input Fallback */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!textInputQuery.trim()) return;
                  const lower = textInputQuery.trim().toLowerCase();
                  const chosenMode: VistaMode =
                    activePromptMode === 'find' || lower.startsWith('find ') ? 'find' : 'ask';
                  runVisualAnalysis(chosenMode, textInputQuery.trim());
                }}
                className="flex items-center gap-2 pt-1"
              >
                <label htmlFor="vista-query-input" className="sr-only">
                  Type a question to ask or an object to find
                </label>
                <input
                  id="vista-query-input"
                  type="text"
                  value={textInputQuery}
                  onChange={(e) => setTextInputQuery(e.target.value)}
                  placeholder={
                    activePromptMode === 'find'
                      ? 'Type object to find (e.g., water bottle, door)...'
                      : 'Ask a question (e.g., What is on the table?)...'
                  }
                  className={`flex-1 min-h-[44px] px-3.5 py-2 rounded-xl border text-xs sm:text-sm transition-colors ${
                    isDarkTheme
                      ? 'bg-slate-950 border-slate-800 text-white placeholder:text-slate-500 focus:border-blue-500'
                      : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600'
                  }`}
                />
                <button
                  type="submit"
                  disabled={!textInputQuery.trim() || status === 'analyzing'}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold text-xs sm:text-sm whitespace-nowrap shrink-0 transition-colors shadow-xs"
                >
                  {activePromptMode === 'find' ? 'Find' : 'Ask'}
                </button>
              </form>
            </div>
          </section>
        </div>

        {/* ACCESSIBLE KEYBOARD & VOICE SHORTCUTS PANEL (Collapsible) */}
        {showShortcutsModal && (
          <section
            aria-label="Keyboard and voice commands reference"
            className={`p-5 sm:p-6 rounded-2xl border flex flex-col gap-3 ${surfaceCard}`}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold flex items-center gap-2">
                <Keyboard className="w-5 h-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <span>Hands-Free &ldquo;Jarvis&rdquo; Voice &amp; Keyboard Guide</span>
              </h2>
              <button
                type="button"
                onClick={() => setShowShortcutsModal(false)}
                className={`min-h-[36px] px-3 py-1 rounded-lg border text-xs font-semibold ${
                  isDarkTheme
                    ? 'bg-slate-800 border-slate-700 text-slate-200'
                    : 'bg-slate-100 border-slate-200 text-slate-700'
                }`}
              >
                Close (Esc)
              </button>
            </div>
            <div className={`grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs sm:text-sm ${secondaryText}`}>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">
                  01. Two-Step &ldquo;Jarvis&rdquo; Activation
                </p>
                <p className="mt-1 leading-relaxed">
                  Say <strong>&ldquo;Jarvis&rdquo;</strong> to turn on the microphone. Once the
                  microphone turns red, speak your command (e.g., <em>&ldquo;Describe&rdquo;</em>,{' '}
                  <em>&ldquo;Read&rdquo;</em>, or <em>&ldquo;What is on the table?&rdquo;</em>).
                </p>
              </div>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">02. Keyboard Hotkeys</p>
                <p className="mt-1 leading-relaxed">
                  Press <strong>1</strong> or <strong>D</strong> for Describe · <strong>2</strong>{' '}
                  or <strong>A</strong> for Ask · <strong>3</strong> or <strong>R</strong> for Read
                  · <strong>4</strong> or <strong>F</strong> for Find.
                </p>
              </div>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">03. Audio Control</p>
                <p className="mt-1 leading-relaxed">
                  Press <strong>Spacebar</strong> or tap the Microphone button anytime to start or
                  send speech, or press <strong>Escape</strong> to stop spoken audio.
                </p>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* QUIET ARCHITECTURAL FOOTER */}
      <footer
        className={`w-full px-4 sm:px-8 py-4 border-t text-xs flex flex-col sm:flex-row items-center justify-between gap-2 ${
          isDarkTheme
            ? 'border-slate-800/80 text-slate-400'
            : 'border-slate-200/80 text-slate-500 bg-white/60'
        }`}
      >
        <div>
          <span className="font-medium text-slate-700 dark:text-slate-300">
            VISTA Assistive Visual Companion
          </span>
          <span aria-hidden="true"> · </span>
          <span>Natural Human Voice · Say &ldquo;Jarvis&rdquo; to Activate Mic</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setShowShortcutsModal((prev) => !prev)}
            className="hover:underline underline-offset-4 whitespace-nowrap font-medium"
          >
            Voice &amp; Keyboard Guide
          </button>
        </div>
      </footer>
    </div>
  );
}
