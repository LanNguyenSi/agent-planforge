# Data Classification Matrix

| Data Class | Description | Example Data | Allowed Storage | Encryption | Retention | Access Scope | Logging Restrictions |
|------------|-------------|--------------|-----------------|------------|-----------|--------------|----------------------|
| Public | Safe for broad disclosure | {{publicExamples}} | Standard systems | Recommended | As needed | Broad | None beyond normal hygiene |
| Internal | Non-public business data | {{internalExamples}} | Approved internal systems | Recommended | Defined by owner | Team or company | Avoid unnecessary replication |
| Confidential | Sensitive customer or business data | {{confidentialExamples}} | Controlled systems only | Required | Defined and justified | Need-to-know | Redact in logs |
| Restricted | Highest sensitivity | {{restrictedExamples}} | Approved high-control systems only | Required with strongest controls | Minimize aggressively | Strictly limited and audited | Do not log content |

## Notes

{{notes}}
