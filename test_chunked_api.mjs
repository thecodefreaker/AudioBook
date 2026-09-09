import { Groq } from 'groq-sdk';

const groq = new Groq();

// Taking just the first 175 words (a small chunk) instead of the whole 1600 words.
const chunkContent = `CHAPTER 878: PLAN OF HOPE

It was dark, but it usually always was on this planet. Only this time, Quinn could tell he was in a complete pitch black room due to his eyesight changing. Usually, there would at least be a few lights powered by crystals here and there but not in this place. Wherever that was.

’So this is the outcome in the end.’ Quinn thought to himself as he tried moving his hands but couldn’t budge an inch, and it was the same for his legs as well.

Even without a light source, Quinn could see due to his vampire eyesight. And he could see that he was in some type of cell room. His hands and legs cuffed up. In front of him, one of the doors with the special circular locks. Not that Quinn could reach the lock anyway if he wanted to. Not only his arms but his legs were tied up, but they were up against the wall as well.

There was no chain, his limbs were spread out, and he was unable to move.`;

const userPrompt = "Convert the given English story into natural, beautiful Hinglish. Write it as if the story was originally written in Hindi, not translated from English. Rules: Use simple, natural Hindi mixed with common English words (but keep them in devnagri without transalting) where they sound natural. Keeping the character names, places, powers, abilities, and important terms unchanged. Do not translate names or special terms unnecessarily.This is not translation this is retelling , Understand the meaning first, then rewrite it naturally. Keep the original story, events, emotions, and dialogue exactly the same. Make dialogues sound like real people speaking. Make narration smooth and cinematic. Use short and natural sentences so the story is easy to listen to. Keep the emotional flow of the scene.Main goal to retell this in hindi but as conversations as we use in our daily life in India .. like hinglish things not pure hindi give output in devnagari. I will use this as a script to explain this novel story on youtube.";

async function testChunked() {
  console.log("Testing with YOUR prompt, but using pipeline.js logic (Chunked + Temp 0.35)");
  console.log("Input Word Count:", chunkContent.split(' ').length);
  console.log("-----------------------------------------");

  const chatCompletion = await groq.chat.completions.create({
    messages: [
      { role: "system", content: userPrompt },
      { role: "user", content: chunkContent }
    ],
    model: "openai/gpt-oss-120b",
    temperature: 0.35,  // Pipeline temperature
    max_completion_tokens: 1000,
    top_p: 0.9,
  });

  const output = chatCompletion.choices[0].message.content;
  console.log(output);
  console.log("-----------------------------------------");
  console.log("Output Word Count:", output.split(' ').length);
}

testChunked();
