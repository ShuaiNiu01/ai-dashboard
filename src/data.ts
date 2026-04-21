export interface ApprovalItem {
  id: string;
  action: string;
  requestedAt: string;
  meta: string;
}

export const INITIAL_APPROVALS: ApprovalItem[] = [
  {
    id: "TXN-8921A",
    action: "AUTHORIZE WIRE TRANSFER: $50,000.00 TO VENDOR_CORP",
    requestedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    meta: "REQ_LEVEL: L2 | RISK: LOW",
  },
  {
    id: "TRD-4419B",
    action: "EXECUTE BULK REBALANCE: PORTFOLIO ALPHA",
    requestedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    meta: "ASSETS: 12 | EST_SLIPPAGE: 0.02%",
  },
  {
    id: "SYS-9902C",
    action: "GENERATE QUARTERLY KYC COMPLIANCE REPORT",
    requestedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    meta: "PROFILES: 450 | DB_LOAD: HEAVY",
  },
];
