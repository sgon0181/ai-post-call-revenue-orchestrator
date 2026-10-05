// Seeds the two EXISTING customers used by the support and cancellation demo scenarios.
// (The sales/review/injection callers are intentionally unknown → contact gets created.)
const customers = [
  {
    company: { name: 'Brightline Logistics', domain: 'brightline-logistics.example' },
    contact: { firstname: 'Tom', lastname: 'Nguyen', email: 'tom.nguyen@brightline-logistics.example', phone: '+61400333444', jobtitle: 'IT Manager', company: 'Brightline Logistics', lifecyclestage: 'customer' },
  },
  {
    company: { name: 'Harbour Dental Group', domain: 'harbourdental.example' },
    contact: { firstname: 'Priya', lastname: 'Shah', email: 'priya.shah@harbourdental.example', phone: '+61400555666', jobtitle: 'Operations Director', company: 'Harbour Dental Group', lifecyclestage: 'customer' },
  },
];
return customers.map((c) => ({ json: c }));
