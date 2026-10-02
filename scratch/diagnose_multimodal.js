require('c:/Users/agupt/Documents/QuizFunnel/server/node_modules/dotenv').config({ path: 'c:/Users/agupt/Documents/QuizFunnel/server/.env' });
const { GoogleGenAI } = require('c:/Users/agupt/Documents/QuizFunnel/server/node_modules/@google/genai');

const minimalPdf = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n'
);

const files = [
  {
    originalname: 'GK_Logical_Math_Quiz.pdf',
    mimetype: 'application/pdf',
    buffer: minimalPdf,
    size: minimalPdf.length,
  },
];

console.log('--- DIAGNOSTIC ENVIRONMENT CHECK ---');
console.log('GEMINI_API_KEY set?', Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_google_gemini_api_key_here'));
console.log('ANTHROPIC_API_KEY set?', Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your_anthropic_api_key_here'));

const claudeModels = [
  'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet-20241022',
  'claude-3-opus-20240229',
  'claude-3-5-haiku-20241022',
];

const geminiModels = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash-lite',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

async function testClaude() {
  console.log('\n--- TESTING CLAUDE MODELS ---');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    console.log('[Claude]: No ANTHROPIC_API_KEY provided in .env');
    return;
  }

  const b64 = minimalPdf.toString('base64');
  for (const model of claudeModels) {
    const t0 = Date.now();
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'pdfs-2024-09-25',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 500,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: b64,
                  },
                },
                { type: 'text', text: 'Respond with JSON {"status": "ok"}' },
              ],
            },
          ],
        }),
      });
      const elapsed = Date.now() - t0;
      const resText = await response.text();
      console.log(`[Claude ${model}]: Status=${response.status} in ${elapsed}ms -> ${resText.slice(0, 150)}`);
    } catch (err) {
      console.log(`[Claude ${model}]: Exception in ${Date.now() - t0}ms -> ${err.message}`);
    }
  }
}

async function testGemini() {
  console.log('\n--- TESTING GEMINI MODELS ---');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_google_gemini_api_key_here') {
    console.log('[Gemini]: No GEMINI_API_KEY provided in .env');
    return;
  }

  const ai = new GoogleGenAI({ apiKey });
  const inlineParts = [
    {
      inlineData: {
        mimeType: 'application/pdf',
        data: minimalPdf.toString('base64'),
      },
    },
  ];

  for (const model of geminiModels) {
    const t0 = Date.now();
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [...inlineParts, 'Respond with JSON {"status": "ok"}'],
        config: { responseMimeType: 'application/json' },
      });
      const elapsed = Date.now() - t0;
      console.log(`[Gemini ${model}]: SUCCESS in ${elapsed}ms -> ${response.text?.slice(0, 100)}`);
    } catch (err) {
      console.log(`[Gemini ${model}]: FAILED in ${Date.now() - t0}ms -> ${err.message}`);
    }
  }
}

async function run() {
  await testClaude();
  await testGemini();
}

run();
