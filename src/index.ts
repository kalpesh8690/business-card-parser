export type BusinessCardData = Record<string, string>;

export interface ParseOptions {
  image: string | File | Blob;
  api_key: string;
  fields?: string[];
}

export class GeminiAPIError extends Error {
  constructor(message: string, public responseData?: unknown) {
    super(message);
    this.name = 'GeminiAPIError';
  }
}

async function normalizeToBase64(input: string | File | Blob): Promise<string> {
  if (typeof input === 'string') {
    const match = input.match(/^data:.*?;base64,(.*)$/);
    return match ? match[1] : input;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(input);
  });
}

/**
 * Parses a business card image using Gemini API.
 * @param options Object containing image, api_key, and optional fields array
 */
export async function parseBusinessCardImage({
  image,
  api_key,
  fields = ['name', 'title', 'company', 'email', 'phone', 'website', 'address'],
}: ParseOptions): Promise<BusinessCardData> {
  if (!image) throw new Error('Missing required parameter: image');
  if (!api_key) throw new Error('Missing required parameter: api_key');

  const base64Image = await normalizeToBase64(image);

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${api_key}`;

  const prompt = `
Extract the following fields from this business card image:
${fields.map(f => `- ${f}`).join('\n')}

Respond ONLY in valid JSON format:
{
${fields.map(f => `  "${f}": ""`).join(',\n')}
}
`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Image,
            },
          },
        ],
      },
    ],
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await response.json();
  const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new GeminiAPIError('Gemini API returned no valid content.', json);
  }

  try {
    const parsed: BusinessCardData = JSON.parse(rawText.trim());

    for (const field of fields) {
      if (!(field in parsed)) {
        throw new GeminiAPIError(`Missing expected field: "${field}"`, parsed);
      }
    }

    return parsed;
  } catch {
    throw new GeminiAPIError('Invalid JSON format in Gemini response.', rawText);
  }
}
