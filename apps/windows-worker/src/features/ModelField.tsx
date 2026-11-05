import { useState } from "react";
import { Select } from "../ui/Select";

export function ModelField({
  value,
  models,
  label,
  disabled,
  onChange,
}: {
  value: string;
  models: string[];
  label: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [manual, setManual] = useState(false);
  const custom = manual || (!!value && !models.includes(value));
  return (
    <div className="setup-model-field">
      <Select
        aria-label={label}
        value={custom ? "custom" : value ? `model:${value}` : ""}
        disabled={disabled}
        onValueChange={(next) => {
          setManual(next === "custom");
          if (next !== "custom") onChange(next.slice(6));
        }}
      >
        <option value="">Chọn model</option>
        {models.map((model) => (
          <option key={model} value={`model:${model}`}>
            {model}
          </option>
        ))}
        <option value="custom">Nhập model ID…</option>
      </Select>
      {custom && (
        <input
          aria-label={`${label} · ID`}
          value={value}
          disabled={disabled}
          maxLength={200}
          placeholder="Model ID trong gateway"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
