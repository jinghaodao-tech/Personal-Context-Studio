# PCS semantic sensitivity taxonomy

This is the product-policy taxonomy for the semantic layer. It is stricter
than a generic PII detector: names, email addresses, phone numbers and postal
addresses belong to the value-PII layer, not this taxonomy.

## Categories

| Category | Include | Exclude | Hold for review |
| --- | --- | --- | --- |
| `income_finance` | salary, income, debt, savings, household budget, financial hardship | prices, utility bills, generic economic news | ambiguous personal-vs-general financial context |
| `health_history` | diagnosis, disease history, symptoms, treatment, medication, health-check results | general health articles, exercise duration alone, another person's health | vague wellness wording without a clear personal reference |
| `religion_belief` | the person's religion, faith, creed, ideology or political belief | a book purchase, venue visit or news article alone | an activity that only implies a belief |
| `sexual_orientation` | the person's sexual orientation or stated romantic/sexual attraction pattern | ordinary dating history or relationship status alone | ambiguous attraction wording or third-party information |

The detector must prefer `on_hold`/human Review when the text is ambiguous. A
positive match means the field describes the person's own information, not a
generic topic or another person.

This taxonomy is a product policy. Legal classification must still be checked
against the applicable jurisdiction and current guidance.
