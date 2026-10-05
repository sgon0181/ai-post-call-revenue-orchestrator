// Custom HubSpot contact properties used by the main workflow.
// Safe to run repeatedly: "already exists" (409) responses are reported, not failed.
const props = [
  {
    name: 'aircall_churn_risk',
    label: 'Aircall churn risk',
    type: 'enumeration',
    fieldType: 'select',
    groupName: 'contactinformation',
    description: 'Set by the Aircall AI call-intelligence workflow',
    options: ['none', 'low', 'medium', 'high'].map((v, i) => ({ label: v[0].toUpperCase() + v.slice(1), value: v, displayOrder: i })),
  },
  { name: 'aircall_last_intent', label: 'Aircall last call intent', type: 'string', fieldType: 'text', groupName: 'contactinformation' },
  { name: 'aircall_last_call_id', label: 'Aircall last call ID', type: 'string', fieldType: 'text', groupName: 'contactinformation' },
];
return props.map((p) => ({ json: p }));
