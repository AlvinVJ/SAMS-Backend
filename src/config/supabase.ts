import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const globalForSupabase = globalThis as unknown as {
    supabase?: ReturnType<typeof createClient>;
};

if (!supabaseUrl || !supabaseKey) {
    throw new Error(
        "Missing Supabase configuration. Please check your .env file."
    );
}

export const supabase =
    globalForSupabase.supabase ?? createClient(supabaseUrl, supabaseKey);

if (process.env.NODE_ENV !== "production") {
    globalForSupabase.supabase = supabase;
}
