const DECIMAL_PATTERN = /^(?<sign>[+-]?)(?<integer>\d+)(?<fraction>\.\d+)?$/;

export function formatDecimalString(value: string, locale = "zh-CN"): string {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match?.groups) return value;

  const { sign, fraction = "" } = match.groups;
  const integer = match.groups.integer.replace(/^0+(?=\d)/, "");
  const separator = new Intl.NumberFormat(locale).formatToParts(1000)
    .find((part) => part.type === "group")?.value ?? ",";
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, separator);

  return `${sign === "+" ? "" : sign}${grouped}${fraction}`;
}
