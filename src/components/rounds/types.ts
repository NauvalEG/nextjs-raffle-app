// Serialized shapes passed from the Rounds page (server) into the client
// builder components (E1-03).

export type RevealModeValue = "SEQUENTIAL" | "SIMULTANEOUS";

export type AllocationData = {
  id: string;
  prizeTypeId: string;
  quantity: number;
};

export type RoundData = {
  id: string;
  order: number;
  label: string;
  revealMode: RevealModeValue;
  allocations: AllocationData[];
};

export type PrizeTypeOption = {
  id: string;
  name: string;
};
