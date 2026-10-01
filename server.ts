import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not configured.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const ttsCache = new Map<string, string>();

// Generate warm, friendly, human-like neural speech (WAV 24kHz) using Gemini 3.8 TTS models
async function synthesizeHumanVoiceWavBase64(textToSpeak: string): Promise<string | null> {
  const cleaned = (textToSpeak || '').trim();
  if (!cleaned) return null;

  const cached = ttsCache.get(cleaned);
  if (cached) {
    return cached;
  }

  const ai = getGenAIClient();
  const ttsModels = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];

  for (const ttsModel of ttsModels) {
    try {
      const response = await ai.models.generateContent({
        model: ttsModel,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: cleaned,
                speechMetadata: {
                  style:
                    'Warm, friendly, natural, reassuring human companion speaking clearly and conversationally',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        if (ttsCache.size < 40) {
          ttsCache.set(cleaned, base64Audio);
        }
        return base64Audio;
      }
    } catch (err) {
      console.warn(`TTS model ${ttsModel} failed, trying next:`, err);
    }
  }

  return null;
}

// Map demo scene IDs to their local image files (used ONLY when sourceMode === 'demo')
const DEMO_SCENE_FILES: Record<string, string> = {
  'desk-doorway': path.join(__dirname, 'src/assets/images/demo_desk_doorway_1790829480024.jpg'),
  'sign-menu': path.join(__dirname, 'src/assets/images/demo_sign_menu_1790829497307.jpg'),
  'room-backpack': path.join(__dirname, 'src/assets/images/demo_room_backpack_1790829509334.jpg'),
  'counter-label': path.join(__dirname, 'src/assets/images/demo_counter_label_1790829521020.jpg'),
};

function loadDemoSceneBase64(sceneId?: string): string | null {
  const targetFile =
    DEMO_SCENE_FILES[sceneId || 'desk-doorway'] || DEMO_SCENE_FILES['desk-doorway'];
  try {
    if (fs.existsSync(targetFile)) {
      return fs.readFileSync(targetFile).toString('base64');
    }
  } catch (err) {
    console.error('Failed to read local demo scene file:', err);
  }
  return null;
}

const VISTA_SYSTEM_INSTRUCTION = `You are VISTA, a warm, friendly, human-like visual companion for people who are blind or have low vision.

VOICE & PERSONALITY GUIDELINES:
- Speak like a caring, observant, natural human friend standing right beside the user—never stiff, clinical, or robotic.
- Use natural conversational phrasing and contractions ("Right in front of you there's...", "I can see...", "Here's what it says...").
- Keep spokenResponse concise (1 to 3 warm, natural sentences) so it feels effortless to listen to.
- Never use markdown symbols, bullet points, asterisks, or numbered lists.
- Never say the word "Jarvis" in your spokenResponse.

CRITICAL SAFETY & ETHICAL RULES:
1. You are an assistive prototype, NOT a replacement for a cane, guide dog, caregiver, or professional mobility aid.
2. NEVER guarantee physical safety, never claim a path or floor is clear or safe to walk, and never claim to detect every obstacle.
3. NEVER provide exact distance measurements in feet, inches, meters, or centimeters. Always use approximate relative camera-frame directions such as "directly ahead", "just to the left of center", "over on your right", or "on the table".
4. Describe strictly what is actually visible in the provided camera image. Do NOT invent, guess, or hallucinate objects or text that cannot be clearly seen in the image. If the image is blurry, dark, or unclear, let the user know warmly and suggest steadying or angling the camera.`;

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '25mb' }));

  // Dedicated Neural Human Text-to-Speech Endpoint
  app.post('/api/vista/tts', async (req, res) => {
    try {
      const { text = '' } = req.body || {};
      const audioBase64 = await synthesizeHumanVoiceWavBase64(text);
      res.json({ audioBase64 });
    } catch (err) {
      console.error('TTS endpoint error:', err);
      res.json({ audioBase64: null });
    }
  });

  // Multimodal Scene Analysis Endpoint (DESCRIBE, ASK, READ, FIND) + Built-in Human Neural Voice Generation
  app.post('/api/vista/analyze', async (req, res) => {
    const {
      mode = 'describe',
      sourceMode = 'camera',
      imageBase64 = '',
      mimeType = 'image/jpeg',
      query = '',
      demoSceneId = 'desk-doorway',
    } = req.body || {};

    try {
      let cleanBase64 = '';
      let resolvedMimeType = mimeType || 'image/jpeg';

      if (typeof imageBase64 === 'string' && imageBase64.length > 100) {
        const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.*)$/);
        if (match) {
          resolvedMimeType = match[1];
          cleanBase64 = match[2].trim();
        } else {
          cleanBase64 = imageBase64.replace(/^data:[^,]+,/, '').trim();
        }
      }

      // ONLY load demo scene from disk if the user is explicitly in 'demo' mode!
      // NEVER substitute a demo scene when the user is using their live camera!
      if (!cleanBase64 || cleanBase64.length < 200) {
        if (sourceMode === 'demo') {
          const fallbackBase64 = loadDemoSceneBase64(demoSceneId);
          if (fallbackBase64) {
            cleanBase64 = fallbackBase64;
            resolvedMimeType = 'image/jpeg';
          }
        }
      }

      if (!cleanBase64 || cleanBase64.length < 200) {
        const msg =
          'Your live camera is still warming up. Please hold steady for a moment and try again.';
        const audioBase64 = await synthesizeHumanVoiceWavBase64(msg);
        res.json({
          spokenResponse: msg,
          fullText: '',
          hasMoreText: false,
          foundStatus: 'unclear',
          keyItems: [],
          audioBase64,
        });
        return;
      }

      const ai = getGenAIClient();

      let modePrompt = '';
      switch (mode) {
        case 'describe':
          modePrompt = `Task: DESCRIBE the actual live camera image warmly and naturally like a helpful friend.
Describe the most useful, relevant information visible in this exact camera frame.
Prioritize:
- people (and what they are doing or wearing)
- doors, doorways, walls, or windows
- furniture (tables, chairs, desks, counters)
- signs and visible text
- everyday objects that appear relevant in the view
- the general spatial layout of the scene using natural relative directions ("right in front of you", "just left of center", "over on your right").

Keep spokenResponse concise and friendly (1 to 3 conversational sentences, under 45 words).`;
          break;

        case 'ask': {
          const userQuestion = query.trim() || 'What is in front of me?';
          modePrompt = `Task: Answer the user's question warmly and conversationally based strictly on this camera frame.
The user asked: "${userQuestion}"
Answer their question directly, naturally, and friendly in 1 to 3 spoken sentences based strictly on what is visible in the current camera frame.
Use natural relative positions ("slightly left of center", "over on the right", "right in front of you") rather than exact distances.
If you can't tell from the current camera angle, let them know kindly and suggest adjusting the camera.`;
          break;
        }

        case 'read':
          modePrompt = `Task: READ visible text in the camera frame in a warm, natural voice.
Identify any visible signs, labels, documents, menus, packaging, or screens in the camera frame.
Rules:
- Do NOT invent or guess text that is blurry or cut off.
- If no text is visible or the image is too blurry to read reliably, set spokenResponse to: "I don't see any clear text in the current view. Try holding the camera steady or pointing it closer to the text." and set hasMoreText to false.
- If the visible text is short (35 words or fewer), read it aloud naturally in spokenResponse (e.g., "Here's what it says: ...") and set hasMoreText to false.
- If the visible text is long (more than 35 words), give a friendly 1 to 2 sentence summary in spokenResponse ending with "Would you like me to read the full text for you?", put the complete verbatim text in fullText, and set hasMoreText to true.`;
          break;

        case 'find': {
          const targetObject =
            query
              .trim()
              .replace(/^(find|where is|locate|look for)\s+(my|the|a|an)?\s*/i, '')
              .trim() ||
            query.trim() ||
            'requested object';
          modePrompt = `Task: Help the user FIND a specific object in the current camera frame warmly and naturally.
The user is looking for: "${targetObject}" (Original request: "${query.trim()}").
Analyze the current camera frame and check whether "${targetObject}" is visible.
- If visible: set foundStatus to "found" and set spokenResponse to a friendly, natural description of where it is in the frame (for example: "I see it! The ${targetObject} is slightly left of center.").
- If not visible: set foundStatus to "not_found" and set spokenResponse to: "I don't see the ${targetObject} in the current view—try panning the camera slowly."
- If the image is too dark or blurry to tell: set foundStatus to "unclear" and let them know warmly that the view is a bit unclear.
Remember: Never state exact distances or guarantee that an object is safe to approach.`;
          break;
        }

        default:
          modePrompt =
            'Describe the useful objects, people, and layout visible in this camera frame warmly and concisely.';
          break;
      }

      const schemaConfig = {
        type: Type.OBJECT,
        properties: {
          spokenResponse: {
            type: Type.STRING,
            description:
              'Warm, friendly, natural human spoken response suitable for immediate audio playback.',
          },
          fullText: {
            type: Type.STRING,
            description:
              'Complete verbatim text from the image when READ mode summarizes a longer passage. Empty string otherwise.',
          },
          hasMoreText: {
            type: Type.BOOLEAN,
            description:
              'True only when READ mode summarized long text and fullText contains additional readable text.',
          },
          foundStatus: {
            type: Type.STRING,
            description:
              'For FIND mode: "found", "not_found", or "unclear". For other modes: "not_applicable".',
          },
          keyItems: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              'Up to 4 short 1-3 word labels of key visible items or text regions actually identified in the frame.',
          },
        },
        required: ['spokenResponse', 'fullText', 'hasMoreText', 'foundStatus', 'keyItems'],
      };

      // Prioritized by verified fastest response time and availability
      const candidateModels = [
        'gemini-3.5-flash-lite',
        'gemini-flash-lite-latest',
        'gemini-3.6-flash',
        'gemini-3.1-flash-lite',
        'gemini-3-flash-preview',
        'gemini-3.8-flash',
        'gemini-3.7-flash',
        'gemini-3.5-flash',
      ];

      let rawText = '';
      let lastError: unknown = null;

      for (const modelName of candidateModels) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: resolvedMimeType,
                    data: cleanBase64,
                  },
                },
                {
                  text: modePrompt,
                },
              ],
            },
            config: {
              systemInstruction: VISTA_SYSTEM_INSTRUCTION,
              temperature: 0.3,
              responseMimeType: 'application/json',
              responseSchema: schemaConfig,
            },
          });

          if (response.text) {
            rawText = response.text.trim();
            break;
          }
        } catch (err) {
          lastError = err;
          console.warn(`Vision model ${modelName} failed, trying next:`, err);
        }
      }

      if (!rawText) {
        throw lastError || new Error('All vision models were temporarily busy.');
      }

      const cleanedJson = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

      let parsed = {
        spokenResponse: "I couldn't quite make out the scene right now. Could you try again?",
        fullText: '',
        hasMoreText: false,
        foundStatus: 'not_applicable',
        keyItems: [] as string[],
      };

      try {
        parsed = JSON.parse(cleanedJson);
      } catch {
        parsed.spokenResponse = rawText;
      }

      // Synthesize natural human voice WAV right away
      const audioBase64 = await synthesizeHumanVoiceWavBase64(parsed.spokenResponse);

      res.json({
        ...parsed,
        audioBase64,
      });
    } catch (error: unknown) {
      console.error('VISTA analyze error:', error);
      const errorMsg =
        'I had a brief connection hiccup while looking at the camera feed. Please press Describe or try again in a moment.';
      const audioBase64 = await synthesizeHumanVoiceWavBase64(errorMsg);
      res.json({
        spokenResponse: errorMsg,
        fullText: '',
        hasMoreText: false,
        foundStatus: 'unclear',
        keyItems: [],
        audioBase64,
      });
    }
  });

  // Fast Audio Transcription Endpoint (supports mode: 'wake_check' | 'command')
  app.post('/api/vista/transcribe', async (req, res) => {
    try {
      const { audioBase64, mimeType = 'audio/webm', mode = 'command' } = req.body || {};
      if (!audioBase64 || typeof audioBase64 !== 'string') {
        res.status(400).json({ error: 'No audio data provided.' });
        return;
      }

      const cleanAudio = audioBase64.replace(/^data:[^,]+,/, '').trim();
      if (cleanAudio.length < 200) {
        res.json({ transcript: '', isJarvisWakeWord: false });
        return;
      }

      let resolvedMime = (mimeType || 'audio/webm').split(';')[0].trim();
      if (resolvedMime === 'video/webm' || !resolvedMime.startsWith('audio/')) {
        resolvedMime = 'audio/webm';
      }

      const ai = getGenAIClient();
      let transcript = '';
      let isJarvisWakeWord = false;

      const promptText =
        mode === 'wake_check'
          ? `Listen carefully to this short audio clip and determine if a person is saying the wake word "Jarvis".
STRICT RULES:
1. If the audio is only background noise, room hum, clicks, taps, breathing, coughing, or silence with no spoken words, you MUST set hasClearSpeech to false, isJarvisWakeWord to false, and transcript to "".
2. If a human voice says "Jarvis" (or "Hey Jarvis", "Hi Jarvis", "Okay Jarvis", or a close phonetic pronunciation of Jarvis such as "Jervis", "Gervais", "Javis", "Charvis", "Harvis", "Travis", "Chavez", "Darvis", "Marvis", "Garvis", "Carvis", "Jarv", "Jarvez"), set hasClearSpeech to true, set isJarvisWakeWord to true, and set transcript to "Jarvis".
3. If a human voice clearly speaks other words that do NOT sound like "Jarvis", set hasClearSpeech to true, isJarvisWakeWord to false, and write the spoken words in transcript.`
          : `Transcribe the spoken English request in this audio clip verbatim.
STRICT RULES:
1. If the audio is only background noise, clicks, breathing, or silence with no clear human speech, set hasClearSpeech to false, isJarvisWakeWord to false, and transcript to "".
2. If a person clearly speaks a question or command (such as "describe", "read", "find my water bottle", "what is in front of me"), set hasClearSpeech to true and write the exact spoken words in transcript.`;

      const transcribeSchema = {
        type: Type.OBJECT,
        properties: {
          hasClearSpeech: {
            type: Type.BOOLEAN,
            description:
              'True ONLY if a human voice is speaking words. False for any background noise, clicks, breathing, hum, or silence.',
          },
          isJarvisWakeWord: {
            type: Type.BOOLEAN,
            description:
              'True if the speaker said the wake word "Jarvis" (or a close phonetic pronunciation of "Jarvis"). False otherwise.',
          },
          transcript: {
            type: Type.STRING,
            description:
              'Exact transcription of the spoken words, or empty string if hasClearSpeech is false.',
          },
        },
        required: ['hasClearSpeech', 'isJarvisWakeWord', 'transcript'],
      };

      const transcribeModels = [
        'gemini-flash-lite-latest',
        'gemini-3.5-flash-lite',
        'gemini-3.6-flash',
        'gemini-3.1-flash-lite',
        'gemini-3.8-flash',
      ];

      for (const modelName of transcribeModels) {
        try {
          const trRes = await ai.models.generateContent({
            model: modelName,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: resolvedMime,
                    data: cleanAudio,
                  },
                },
                {
                  text: promptText,
                },
              ],
            },
            config: {
              temperature: 0.0,
              responseMimeType: 'application/json',
              responseSchema: transcribeSchema,
            },
          });

          if (trRes.text) {
            try {
              const parsed = JSON.parse(trRes.text.trim()) as {
                hasClearSpeech?: boolean;
                isJarvisWakeWord?: boolean;
                transcript?: string;
              };
              if (parsed.hasClearSpeech) {
                isJarvisWakeWord = Boolean(parsed.isJarvisWakeWord);
                const cleaned = (parsed.transcript || '').trim();
                if (
                  cleaned &&
                  cleaned.toUpperCase() !== 'SILENCE' &&
                  cleaned.toUpperCase() !== 'NONE'
                ) {
                  transcript = cleaned;
                } else if (isJarvisWakeWord) {
                  transcript = 'Jarvis';
                }
              }
            } catch {
              // ignore malformed JSON
            }
            break;
          }
        } catch (err) {
          console.warn(`Audio transcription model ${modelName} error:`, err);
        }
      }

      res.json({ transcript, isJarvisWakeWord });
    } catch (error: unknown) {
      console.error('VISTA transcribe error:', error);
      res.json({ transcript: '', isJarvisWakeWord: false });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VISTA server listening on http://0.0.0.0:${PORT}`);
    // Pre-warm the "Jarvis" confirmation voice so it plays with zero latency
    synthesizeHumanVoiceWavBase64("Yes, I'm listening. Go ahead.").catch(() => {});
    synthesizeHumanVoiceWavBase64("Yes, I'm listening. What do you need?").catch(() => {});
  });
}

startServer();
