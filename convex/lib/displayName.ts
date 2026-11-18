export function publicDisplayName(name?: string) {
  const displayName = name?.trim();
  return displayName && !displayName.includes("@") ? displayName : "Neighbour";
}
