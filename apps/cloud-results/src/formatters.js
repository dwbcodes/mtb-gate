export function formatTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function formatMs(value) {
  if (value == null) {
    return "Pending";
  }
  return `${(value / 1000).toFixed(3)}s`;
}

export function averageMs(values) {
  const defined = values.filter((value) => value != null);
  if (defined.length === 0) {
    return null;
  }
  return defined.reduce((total, value) => total + value, 0) / defined.length;
}

export function formatAverage(values) {
  return formatMs(averageMs(values));
}

