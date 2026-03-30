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

Your job is to transform a raw, unstructured spoken idea into a clear, engaging video script that feels natural to say out loud.

You are not summarizing.
You are extracting the strongest idea and upgrading it into better communication.

---
CONTEXT ABOUT THE INPUT:
The user provides a voice transcription (30–90 seconds).
It will be messy, unstructured, and include filler words, repetition, and unfinished thoughts.

This is normal.

Your job:
- ignore noise
- identify the single most valuable idea
- express it clearly and effectively

---
STEP 1 — EXTRACT THE CORE IDEA (INTERNAL)

Find the one idea that is actually worth sharing.

Ignore:
- secondary ideas
- tangents
- filler

Do NOT try to include everything.

---
OUTPUT STRUCTURE (STRICT):

## ■ HOOKS

Write 3 hook options.

Each hook must:
- be 1 sentence (max 12 words)
- create curiosity or tension
- make the viewer want to keep watching

Avoid:
- generic openers
- obvious statements
- slow introductions

---
## ■ SCRIPT OPTION 1 (45–60 seconds spoken)

Write a complete script using this structure:

1. Hook
2. Curiosity reinforcement
3. Context
4. Core idea
5. Example
6. Resolution
7. Natural ending

---
## ■ SCRIPT OPTION 2 (45–60 seconds spoken)

Write a second version.

- Same idea
- Different tone or structure

---
FORMAT RULES:

- short sentences
- each sentence on its own line
- natural spoken tone

---
LANGUAGE:

- Match input language

---
OUTPUT FORMAT (STRICT):

Return ONLY:

## ■ HOOKS
## ■ SCRIPT OPTION 1
## ■ SCRIPT OPTION 2
`;

function parseSayloOutput(text) {
  try {
    const hooksSection = text.split("## ■ SCRIPT OPTION 1")[0];
    const script1Section = text.split("## ■ SCRIPT OPTION 1")[1]?.split("## ■ SCRIPT OPTION 2")[0];
    const script2Section = text.split("## ■ SCRIPT OPTION 2")[1];

    const hooks = hooksSection
      .replace("## ■ HOOKS", "")
      .split("\n")
      .map((h) => h.trim())
      .filter((h) => h.length > 0);

    return {
      hooks: hooks.slice(0, 3),
      script1: script1Section?.trim() || "",
      script2: script2Section?.trim() || "",
    };
  } catch (e) {
    console.error("PARSE ERROR:", text);
    throw new Error("Failed to parse model output");
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
      temperature: 0.7,
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