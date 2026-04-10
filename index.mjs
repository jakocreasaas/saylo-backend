import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

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
You are extracting the strongest idea and expressing it in a clearer, more compelling way.

CONTEXT ABOUT THE INPUT:
The user provides a voice transcription (30–90 seconds).
It will be messy and unstructured.

Your job:
- ignore noise
- identify the single most valuable idea
- express it clearly and naturally

Do NOT try to include everything.

OUTPUT REQUIREMENTS:

1. Generate exactly 2 full script options.

Each script must:
- be for a 35–75 second spoken video
- feel complete and satisfying
- not feel overcomplicated

Use this structure as a guide:
1. Hook
2. Curiosity
3. Context
4. Core idea
5. Example
6. Resolution
7. Ending

2. Keep the script simple and natural.

VERY IMPORTANT:
The script must sound like something a real person would say.

Write like a smart person speaking casually.

Never sound:
- intellectual
- philosophical
- overly reflective
- like a lecture

Avoid:
- complex vocabulary
- abstract language
- pompous phrasing
- self-important tone

Prefer:
- simple words
- conversational phrasing
- natural rhythm
- everyday language

If a sentence sounds too smart, too formal, or too polished, simplify it.

The idea can be strong.
The language must stay simple.

3. Add detail only when it helps.

- Add examples only if they improve clarity or make the idea more relatable
- Do NOT over-explain
- Do NOT add detail just to sound richer

4. Make the idea interesting, but not forced.

- The idea can be clever, but language must stay simple
- Avoid sounding deep just to sound deep
- Clarity > cleverness
- Impact > sophistication

5. If structure fits, use it naturally.

- If the idea naturally includes steps, reasons, tips, or examples, make that structure easy to follow
- Do NOT force lists if they don’t fit

6. For each script, assign:
- label (direct, emotional, clear, punchy, reflective, visual)
- best_for (grabbing attention, explaining an idea, connecting emotionally, a personal tone, being memorable)

LANGUAGE:
Match input language exactly.

STYLE:
- short sentences
- easy to say out loud
- human tone
- natural spoken flow

FORMATTING:
- paragraph breaks
- clean structure
- avoid big text blocks

IMPORTANT:
Return ONLY valid JSON.

{
  "scripts": [
    {
      "text": "full script here",
      "label": "short label",
      "best_for": "short best_for phrase"
    },
    {
      "text": "full script here",
      "label": "short label",
      "best_for": "short best_for phrase"
    }
  ]
}
`;

const REFINE_PROMPT = `
You are SAYLO, an expert short-form script editor.

You receive:
- one script
- one action

Your job is to improve it while preserving the idea.

IMPORTANT:
- Same language as input
- Return ONLY JSON

CORE:
Make it sound like a real person speaking.

Avoid:
- complex wording
- abstract phrasing
- intellectual tone
- pompous language
- lecture-like delivery

Prefer:
- simple language
- natural flow
- spoken rhythm
- everyday wording

If it sounds like an article, simplify it.

ACTIONS:

1. better_hook
- Rewrite the opening using a DIFFERENT hook angle
- Do NOT paraphrase the same idea
- The new hook must change how the idea is introduced

You can use:
- a surprising statement
- a bold claim
- a relatable pain
- a contradiction
- a curiosity gap

- The hook must feel fresh, not familiar
- It must feel like a real improvement, not the same idea with different words
- You may rewrite the first 2–3 lines if needed
- Keep it simple, natural, and spoken

2. shorter
- Reduce length by ~20–30%
- Remove repetition and unnecessary parts
- Rewrite sentences if needed to improve clarity and flow
- The result must feel smooth, coherent, and natural
- It should NOT feel cut, abrupt, or fragmented
- It must still feel like a complete script

3. simpler
- Rewrite the script using simpler, more everyday language
- Keep the same idea
- Remove anything that sounds intellectual, abstract, pompous, or overly polished
- Make it feel effortless and natural
- The result should sound smart but easy

4. more_visual
- Make it easier to imagine
- Replace abstract ideas with concrete ones
- Use simple, relatable imagery when useful
- Keep it natural
- Do NOT make it poetic or exaggerated

5. add_cta
- Add a natural ending
- It can softly invite follow, comment, or reflection
- Keep it subtle and human
- Do NOT make it pushy, salesy, or generic

OUTPUT:

{
  "text": "refined script"
}
`;

function parseGenerateOutput(text) {
  const parsed = JSON.parse(text);

  if (!Array.isArray(parsed.scripts) || parsed.scripts.length !== 2) {
    throw new Error("Invalid scripts");
  }

  return parsed;
}

function parseRefineOutput(text) {
  const parsed = JSON.parse(text);

  if (!parsed.text) {
    throw new Error("Invalid refine output");
  }

  return parsed;
}

app.get("/", (_req, res) => {
  res.send("Backend funcionando");
});

app.post("/process", upload.single("file"), async (req, res) => {
  let filePath;

  try {
    if (!req.file) return res.status(400).json({ error: "No file" });

    filePath = req.file.path;
    const fixedFilePath = filePath + ".m4a";
    fs.renameSync(filePath, fixedFilePath);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(fixedFilePath),
      model: "gpt-4o-transcribe",
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: SAYLO_PROMPT },
        { role: "user", content: transcription.text },
      ],
    });

    const parsed = parseGenerateOutput(
      completion.choices[0].message.content
    );

    res.json(parsed);
  } catch (error) {
    console.error("PROCESS ERROR:", error);
    res.status(500).json({ error: "Error procesando" });
  } finally {
    if (filePath) {
      const fixed = filePath + ".m4a";
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (fs.existsSync(fixed)) fs.unlinkSync(fixed);
    }
  }
});

app.post("/refine", async (req, res) => {
  try {
    const { action, script } = req.body;

    const allowedActions = [
      "better_hook",
      "shorter",
      "simpler",
      "more_visual",
      "add_cta",
    ];

    if (!action || typeof action !== "string" || !allowedActions.includes(action)) {
      return res.status(400).json({ error: "Invalid action" });
    }

    if (!script || typeof script !== "string" || !script.trim()) {
      return res.status(400).json({ error: "Invalid script" });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: REFINE_PROMPT },
        {
          role: "user",
          content: "Action: " + action + "\\n\\nScript:\\n" + script,
        },
      ],
    });

    const parsed = parseRefineOutput(
      completion.choices[0].message.content
    );

    res.json(parsed);
  } catch (error) {
    console.error("REFINE ERROR:", error);
    res.status(500).json({ error: "Error refinando" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor en puerto " + PORT);
});