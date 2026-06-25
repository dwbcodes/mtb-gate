export interface StackShape {
  apiName: string;
  tableName: string;
  resultIndexes: string[];
}

export function describeInfraStack(): StackShape {
  return {
    apiName: "mtb-gate-api",
    tableName: "mtb-gate-single-table",
    resultIndexes: [
      "gsi1-by-date",
      "gsi2-by-rider-date"
    ]
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(describeInfraStack(), null, 2));
}

