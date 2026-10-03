export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          best_wave: number;
          color: string;
          created_at: string;
          id: string;
          kills: number;
          matches: number;
          username: string;
        };
        Insert: {
          best_wave?: number;
          color?: string;
          created_at?: string;
          id: string;
          kills?: number;
          matches?: number;
          username: string;
        };
        Update: {
          best_wave?: number;
          color?: string;
          created_at?: string;
          id?: string;
          kills?: number;
          matches?: number;
          username?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
