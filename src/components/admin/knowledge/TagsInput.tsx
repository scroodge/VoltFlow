export function TagsInput({
  name,
  label,
  defaultValue = [],
}: {
  name: string;
  label: string;
  defaultValue?: string[];
}) {
  return (
    <label className="space-y-1.5 text-sm font-semibold">
      <span>{label}</span>
      <input
        name={name}
        defaultValue={defaultValue.join(", ")}
        className="min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        placeholder="charging, winter, safety"
      />
      <span className="block text-xs font-normal text-muted-foreground">
        Separate values with commas.
      </span>
    </label>
  );
}
