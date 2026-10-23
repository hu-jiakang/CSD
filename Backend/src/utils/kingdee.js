export function escapeKingdeeValue(value) {
  return String(value ?? "").replace(/'/g, "''");
}

export function normalizeKey(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function buildOrFilter(fieldKey, values) {
  const uniqueValues = [
    ...new Set(
      (values || [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    ),
  ];

  if (!uniqueValues.length) return "";

  return `(${uniqueValues
    .map((value) => `${fieldKey} = '${escapeKingdeeValue(value)}'`)
    .join(" OR ")})`;
}

export function buildOrganizationFilter(organizationField, organization) {
  return `${organizationField} = '${escapeKingdeeValue(organization)}'`;
}

export function buildStoreFilter(organizationField, organization) {
  return [
    buildOrganizationFilter(organizationField, organization),
    "FNumber LIKE 'STR.%'",
  ].join(" AND ");
}

export function rowsToObjects(rows, fieldKeys) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    if (row !== null && typeof row === "object" && !Array.isArray(row)) {
      return row;
    }
    const output = {};
    fieldKeys.forEach((fieldKey, index) => {
      output[fieldKey] = Array.isArray(row) ? row[index] ?? "" : "";
    });
    return output;
  });
}
