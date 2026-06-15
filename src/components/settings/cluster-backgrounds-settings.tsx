"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type BackgroundRow = {
  id: string;
  display_name: string;
  created_at: string;
};

export function ClusterBackgroundsSettings() {
  const [rows, setRows] = useState<BackgroundRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const response = await fetch("/api/cluster-backgrounds", { credentials: "include" });
    const payload = (await response.json()) as {
      ok?: boolean;
      backgrounds?: BackgroundRow[];
      error?: string;
    };
    if (!response.ok || !payload.ok) {
      setError(payload.error ?? "Failed to load backgrounds");
      setRows([]);
      return;
    }
    setRows(payload.backgrounds ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onUpload(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/cluster-backgrounds", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Upload failed");
        return;
      }
      await load();
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div>
        <h3 className="text-sm font-medium">Cluster backgrounds</h3>
        <p className="text-muted-foreground text-xs">
          Upload 1280×480-friendly images for VoltFlow Dashboard on your BYD cluster.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="cluster-bg-upload">Upload PNG or JPG (max 5 MB)</Label>
        <Input
          id="cluster-bg-upload"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploading}
          onChange={(event) => void onUpload(event.target.files?.[0] ?? null)}
        />
      </div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <ul className="space-y-1 text-sm">
        {rows.map((row) => (
          <li key={row.id} className="text-muted-foreground">
            {row.display_name}
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
        Refresh
      </Button>
    </div>
  );
}
