# PriorityCare test logins

Created by step 2 (`20261019_05_resident_signup_and_test_logins.sql`). Test data only: do not reuse these passwords anywhere real, and keep this file out of git.

## Web (staff)

These accounts already existed and keep the passwords you set.

| Role | Email | Scope |
|---|---|---|
| Municipal admin (super_admin) | superadmin@gmail.com | All 13 barangays |
| Barangay admin | victor@gmail.com | Alegria (1) |
| Barangay admin | normaladmin@gmail.com | Buagsong (3) |

## App: rescuers (email + password)

| Name | Email | Password | Barangay | Unit |
|---|---|---|---|---|
| Rico Fernandez | rescuer.alegria@prioritycare.local | Rescue2026! | Alegria (1) | Alegria Rescue 1 |
| Joy Villanueva | rescuer.buagsong@prioritycare.local | Rescue2026! | Buagsong (3) | Buagsong Alpha Team |

## App: residents (contact number + PIN)

Every resident PIN is **123456**. Behind the scenes the login email is `<contact number>@resident.prioritycare.local`.

| Head of household | Contact no. | Barangay | Sitio | Verified | Dependents |
|---|---|---|---|---|---|
| Juan Dela Cruz | 09170001111 | Alegria | Sitio Mahayahay | Yes | Liza (spouse, pregnant), Miko (child), Bea (infant) |
| Maria Santos | 09180002222 | Bangbang | Sitio Lawis | Yes | Carmen (mother, senior, wheelchair) |
| Pedro Reyes | 09190003333 | Buagsong | Sitio Kalubihan | No | none (lives alone, renter) |
| Ana Lim | 09200004444 | Poblacion | Sitio Tabay | No | Ben (spouse, needs assistance), Chloe (child, asthma) |
| Rosa Mercado | 09210005555 | Buagsong | Sitio Bitoon | No | Paolo (grandson, caregiver), Teodoro (spouse, bedridden) |

Juan, Maria and Pedro were existing logins (juan@test.com etc.). Step 2 switched them to contact number + PIN.

What each login should see:
- victor@gmail.com: Juan's household only. normaladmin@gmail.com: Pedro and Rosa. superadmin: everyone.
- Rescuers: every resident, household and dependent (they need the field map), but no admin screens.
- Residents: only their own profile and household.
