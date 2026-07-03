import { NextRequest, NextResponse } from "next/server";
import { compile } from "@covenant/policy-compiler";

// Server-side only. GEMINI_API_KEY / GROQ_API_KEY are read here via process.env,
// which is safe on the server — they are never sent to or readable by the browser.
// Do NOT add the NEXT_PUBLIC_ prefix to either key; that would defeat the point of
// routing this through an API route in the first place.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text: string | undefined = body?.text;
    const policyName: string = body?.policyName ?? "frontend-policy";

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'text' field in request body." },
        { status: 400 }
      );
    }

    const result = await compile(text, policyName);
    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Compile failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}