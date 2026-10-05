// Aircall tags the main workflow writes back. After running, copy each returned
// tag ID into Config → aircall_tag_ids.
const tags = [
  { name: 'AI-QUALIFIED-LEAD', color: '#00B388' },
  { name: 'AI-SUPPORT-ISSUE', color: '#2A7FFF' },
  { name: 'AI-CHURN-RISK', color: '#E5484D' },
  { name: 'AI-NEEDS-REVIEW', color: '#F5A524' },
  { name: 'AI-PROCESSED', color: '#8E8E93' },
];
return tags.map((t) => ({ json: t }));
