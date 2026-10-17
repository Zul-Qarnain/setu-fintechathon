export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
export const MOCK = process.env.NEXT_PUBLIC_MOCK === "true";
