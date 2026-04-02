import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import OpenAI from "openai";

const app = express();
app.use(cors());

if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

const upload = multer({ dest: "uploads/" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SAYLO_PROMPT = `
You are SAYLO, an expert script writer for short-form video creators — coaches, educators, and entrepreneurs.

Your job is to transform a raw, unstructured spoken idea into clear, engaging short-form video content that feels natural to say out loud.

You are not summarizing.
You are extracting the strongest idea and upgrading it into better communication.

CONTEXT ABOUT THE INPUT:
The user provides a voice transcription (30–90 seconds).
It will be messy, unstructured, and include filler words, repetition, and unfinished thoughts.

This is normal.

Your job:
- ignore noise
- identify the single most valuable idea
- express it clearly and effectively

INTERNAL TASK:
Find the one idea that is actually worth sharing.
Ignore:
- secondary ideas
- tangents
- filler

Do NOT try to include everything.

OUTPUT REQUIREMENTS:

1. Generate exactly 3 hooks.
Each hook must:
- be 1 sentence
- maximum 12 words
- create curiosity or tension
- make the viewer want to keep watching

2. Generate exactly 2 full script options.

Each script should be optimized for short-form video, but the final length can vary depending on the idea.

Length guidance:
- default: 35–60 seconds spoken
- if the idea is simple and strong, prefer a shorter script
- if the idea needs more clarity or development, extend naturally up to 75 seconds
- never make it longer unless the extra length clearly improves the communication

Do not force all scripts to have the same length.
Prefer the shortest version that still feels clear, sharp, and complete.

Use this structure as a guiding framework, not as a rigid template:
1. Hook
2. Curiosity reinforcement
3. Context
4. Core idea
5. Example
6. Resolution
7. Natural ending

If the idea works better with a simpler or tighter structure, adapt naturally.

3. For each script, assign:
- exactly 1 short label describing the style of the script
- exactly 1 short best_for phrase describing when to use it

The label must match ONE of these concepts:
- direct
- emotional
- clear
- punchy
- reflective
- visual

The best_for must match ONE of these concepts:
- grabbing attention
- explaining an idea
- connecting emotionally
- a personal tone
- being memorable

LANGUAGE:
- Match the input language exactly.
- The hooks, scripts, label, and best_for must all be in the same language as the input.

LANGUAGE RULES FOR label AND best_for:
- They must be written in the same language as the script.
- label must be very short, natural, and polished.
- best_for must be a short natural phrase, not a single keyword.
- best_for should read naturally after a separator like "·".

Examples in English:
- "Direct"
- "More reflective"
- "For grabbing attention"
- "For explaining an idea"

Examples in Spanish:
- "Directo"
- "Más reflexivo"
- "Para captar atención"
- "Para explicar una idea"

Do NOT return single keywords like:
- "attention"
- "explanation"
- "memorability"
- "emotional connection"
- "conexión emocional"

Return natural short phrases instead.

STYLE RULES:
- short sentences
- natural spoken tone
- easy to say out loud
- label must be very short (2–4 words max)
- best_for must be a short natural phrase, not a single keyword

FORMATTING RULES:
- Use natural paragraph breaks.
- Separate ideas with line breaks.
- Keep the hook as its own paragraph.
- Do NOT return one single block of text.
- Avoid excessive empty lines (maximum one empty line between paragraphs).
- If there are lists, sequences, or numbered ideas, separate each idea clearly.
- The script must be visually readable without additional formatting in the app.

IMPORTANT:
Return ONLY valid JSON.
Do not include markdown.
Do not include explanations.
Do not include headings.
Do not wrap the JSON in code fences.

The JSON format must be exactly:

{
  "hooks": ["hook 1", "hook 2", "hook 3"],
  "scripts": [
    {
      "text": "full script here",
      "label": "short label in the same language as the script",
      "best_for": "short best_for phrase in the same language as the script"
    },
    {
      "text": "full script here",
      "label": "short label in the same language as the script",
      "best_for": "short best_for phrase in the same language as the script"
    }
  ]
}
`;

function parseSayloOutput(text) {
  try {
    const parsed = JSON.parse(text);

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Response is not an object");
    }

    if (!Array.isArray(parsed.hooks) || parsed.hooks.length !== 3) {
      throw new Error("hooks must be an array of 3 items");
    }

    if (!Array.isArray(parsed.scripts) || parsed.scripts.length !== 2) {
      throw new Error("scripts must be an array of 2 items");
    }

    parsed.hooks.forEach((hook, index) => {
      if (typeof hook !== "string" || !hook.trim()) {
        throw new Error(`hook ${index + 1} is invalid`);
      }
    });

    parsed.scripts.forEach((script, index) => {
      if (!script || typeof script !== "object") {
        throw new Error(`script ${index + 1} is invalid`);
      }

      if (typeof script.text !== "string" || !script.text.trim()) {
        throw new Error(`script ${index + 1} text is invalid`);
      }

      if (typeof script.label !== "string" || !script.label.trim()) {
        throw new Error(`script ${index + 1} label is invalid`);
      }

      if (typeof script.best_for !== "string" || !script.best_for.trim()) {
        throw new Error(`script ${index + 1} best_for is invalid`);
      }
    });

    return parsed;
  } catch (e) {
    console.error("PARSE ERROR:", text);
    throw new Error(`Failed to parse model output: ${e.message}`);
  }
}

app.get("/", (_req, res) => {
  res.send("Backend funcionando");
});

app.post("/process", upload.single("file"), async (req, res) => {
  let filePath;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    filePath = req.file.path;

    const fixedFilePath = `${filePath}.m4a`;
    fs.renameSync(filePath, fixedFilePath);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(fixedFilePath),
      model: "gpt-4o-transcribe",
    });

    const text = transcription.text;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.5,
      messages: [
        { role: "system", content: SAYLO_PROMPT },
        { role: "user", content: text },
      ],
    });

    const raw = completion.choices[0].message.content;
    const parsed = parseSayloOutput(raw);

    res.json(parsed);
  } catch (error) {
    console.error("PROCESS ERROR:", error);
    res.status(500).json({
      error: "Error procesando",
      details: error?.message ?? "Unknown error",
    });
  } finally {
    if (filePath) {
      const fixedFilePath = `${filePath}.m4a`;

      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (fs.existsSync(fixedFilePath)) fs.unlinkSync(fixedFilePath);
    }
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
});