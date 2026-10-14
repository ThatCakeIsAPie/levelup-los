/**
 * Your list and the customer pipeline (re-exported from "@/data"). The board
 * reuses the recruiting pipeline's rules and UI with CUSTOMER_BOARD; tables
 * live in ./store (browser storage in the demo; in memory with real accounts).
 */
export * from "./types";
export {
  canEditListOf,
  canOwnList,
  cardBand,
  customerBandIndex,
  entryError,
  isCustomerMilestone,
  isSaleBand,
} from "./rules";
export {
  useCustomerPipelineAccess,
  useCustomerColumns,
  useListOwners,
  useYourList,
  useNotContactedCount,
  useListEntry,
  useListUpline,
  useCustomerBoard,
  useCustomerSummary,
  useCustomerActivity,
  useCustomerFunnel,
  useCustomerStepsEditor,
  useDoNotContactIds,
  type ListOwner,
  type ListRow,
  type YourList,
  type CustomerActivity,
  type CustomerRate,
  type CustomerFunnel,
  type CustomerStepsEditorBand,
} from "./hooks";
export {
  addListEntry,
  updateListEntry,
  removeListEntry,
  moveCustomerCard,
  startListEntry,
  addCustomerContact,
  updateCustomerCard,
  addEntryToRecruiting,
  getListEntry,
  type ListEntryInput,
  type EntryResult,
  type CustomerMoveFailure,
  type CustomerMoveResult,
} from "./mutations";
