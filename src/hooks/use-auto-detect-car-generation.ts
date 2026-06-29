"use client";

import { useEffect, useRef } from "react";

import { getUserCarGeneration } from "@/actions/user-car-generation";
import { createClient } from "@/lib/supabase/client";
import type { CarGeneration } from "@/lib/car-generations";

export function useAutoDetectCarGeneration(
  setGeneration: (value: CarGeneration) => void,
  skipIfUrlParam: string | null,
) {
  const done = useRef(false);

  useEffect(() => {
    if (done.current || skipIfUrlParam) return;

    const detect = async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const result = await getUserCarGeneration();
      if (result.generation) {
        setGeneration(result.generation);
      }
      done.current = true;
    };

    detect();
  }, [skipIfUrlParam, setGeneration]);
}
