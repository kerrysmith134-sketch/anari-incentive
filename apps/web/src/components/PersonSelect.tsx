import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext.js";
import { useApiQuery } from "../lib/hooks.js";
import type { PlatformPerson } from "../lib/types.js";
import { displayName } from "../lib/format.js";
import { Select, TextInput } from "./ui.js";

export function usePeople(): {
  people: PlatformPerson[];
  loading: boolean;
  error: Error | undefined;
  reload: () => void;
} {
  const { session } = useAuth();
  const query = useApiQuery<PlatformPerson[]>(
    `/api/v1/platform/tenants/${session.tenantId}/persons`,
  );
  return {
    people: query.data ?? [],
    loading: query.loading,
    error: query.error instanceof Error ? query.error : undefined,
    reload: query.reload,
  };
}

export function PersonSelect({
  value,
  onChange,
  required = true,
  label = "Person",
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  label?: string;
  id?: string;
}) {
  const { people } = usePeople();
  const [manual, setManual] = useState(false);

  useEffect(() => {
    if (!value && people[0]?.id) onChange(people[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people.length]);

  if (people.length > 0 && !manual) {
    return (
      <Select
        id={id}
        value={value}
        required={required}
        onChange={(event) => {
          if (event.target.value === "__manual__") {
            setManual(true);
            onChange("");
          } else {
            onChange(event.target.value);
          }
        }}
      >
        {value && !people.some((person) => person.id === value) ? (
          <option value={value}>{value}</option>
        ) : null}
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.employeeCode} · {person.displayName}
          </option>
        ))}
        <option value="__manual__">Enter a person id…</option>
      </Select>
    );
  }

  return (
    <TextInput
      id={id}
      value={value}
      required={required}
      placeholder={`${label} UUID`}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function personLabel(
  personId: string | undefined,
  people: PlatformPerson[],
): string {
  return displayName(personId, people);
}
