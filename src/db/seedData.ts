import type { DoctorStatus } from '../modules/doctors/doctor.model.js';
import type { PatientStatus } from '../modules/patients/patient.model.js';

export interface SeedDoctor {
  name: string;
  specialization: string;
  hospital: string;
  phone: string;
  email: string;
  status: DoctorStatus;
}

export interface SeedPatient {
  name: string;
  doctorEmail: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  condition: string;
  status: PatientStatus;
  /** Days before "now" — kept relative so the charts always have recent shape. */
  admittedDaysAgo: number;
  phone?: string;
  email?: string;
}

/**
 * 12 doctors, not fewer: at limit=10 this produces a second page, so pagination is
 * demonstrable without hand-editing the limit.
 *
 * "Ashfaqul Asif" is fixed, not generated — it is the target for the `Ash` / `asif`
 * / `qul` substring acceptance checks.
 */
export const SEED_DOCTORS: SeedDoctor[] = [
  { name: 'Ashfaqul Asif', specialization: 'Cardiology', hospital: 'Square Hospital', phone: '+8801711000001', email: 'ashfaqul.asif@careguide.dev', status: 'active' },
  { name: 'Farhana Rahman', specialization: 'Neurology', hospital: 'Square Hospital', phone: '+8801711000002', email: 'farhana.rahman@careguide.dev', status: 'active' },
  { name: 'Imran Hossain', specialization: 'Orthopedics', hospital: 'Evercare Hospital', phone: '+8801711000003', email: 'imran.hossain@careguide.dev', status: 'active' },
  { name: 'Nusrat Jahan', specialization: 'Pediatrics', hospital: 'Evercare Hospital', phone: '+8801711000004', email: 'nusrat.jahan@careguide.dev', status: 'active' },
  { name: 'Tanvir Ahmed', specialization: 'Dermatology', hospital: 'United Hospital', phone: '+8801711000005', email: 'tanvir.ahmed@careguide.dev', status: 'active' },
  { name: 'Sadia Islam', specialization: 'Oncology', hospital: 'United Hospital', phone: '+8801711000006', email: 'sadia.islam@careguide.dev', status: 'on-leave' },
  { name: 'Rafiqul Karim', specialization: 'Gastroenterology', hospital: 'Labaid Specialized', phone: '+8801711000007', email: 'rafiqul.karim@careguide.dev', status: 'active' },
  { name: 'Mehjabin Chowdhury', specialization: 'Endocrinology', hospital: 'Labaid Specialized', phone: '+8801711000008', email: 'mehjabin.chowdhury@careguide.dev', status: 'active' },
  { name: 'Shahriar Kabir', specialization: 'Pulmonology', hospital: 'Ibn Sina Hospital', phone: '+8801711000009', email: 'shahriar.kabir@careguide.dev', status: 'active' },
  { name: 'Anika Tabassum', specialization: 'Nephrology', hospital: 'Ibn Sina Hospital', phone: '+8801711000010', email: 'anika.tabassum@careguide.dev', status: 'active' },
  { name: 'Mahmudul Hasan', specialization: 'Psychiatry', hospital: 'Popular Diagnostic', phone: '+8801711000011', email: 'mahmudul.hasan@careguide.dev', status: 'inactive' },
  // Deliberately has no patients: proves patients-per-doctor includes zero counts.
  { name: 'Rownak Jahan', specialization: 'Rheumatology', hospital: 'Popular Diagnostic', phone: '+8801711000012', email: 'rownak.jahan@careguide.dev', status: 'active' },
];

/**
 * 24 patients spread over ~6 months, covering every status and 10 conditions so the
 * filter dropdowns and charts are not degenerate. Doctor 12 is intentionally empty.
 */
export const SEED_PATIENTS: SeedPatient[] = [
  { name: 'Kamal Uddin', doctorEmail: 'ashfaqul.asif@careguide.dev', age: 58, gender: 'male', condition: 'Hypertension', status: 'active', admittedDaysAgo: 3, phone: '+8801811000001' },
  { name: 'Rehana Begum', doctorEmail: 'ashfaqul.asif@careguide.dev', age: 64, gender: 'female', condition: 'Arrhythmia', status: 'under-observation', admittedDaysAgo: 12 },
  { name: 'Sabbir Rahman', doctorEmail: 'farhana.rahman@careguide.dev', age: 41, gender: 'male', condition: 'Migraine', status: 'recovered', admittedDaysAgo: 27 },
  { name: 'Tahmina Akter', doctorEmail: 'farhana.rahman@careguide.dev', age: 35, gender: 'female', condition: 'Epilepsy', status: 'active', admittedDaysAgo: 45 },
  { name: 'Jahangir Alam', doctorEmail: 'imran.hossain@careguide.dev', age: 52, gender: 'male', condition: 'Fracture', status: 'discharged', admittedDaysAgo: 60 },
  { name: 'Shirin Sultana', doctorEmail: 'imran.hossain@careguide.dev', age: 47, gender: 'female', condition: 'Arthritis', status: 'active', admittedDaysAgo: 8 },
  { name: 'Arif Mahmud', doctorEmail: 'nusrat.jahan@careguide.dev', age: 7, gender: 'male', condition: 'Asthma', status: 'under-observation', admittedDaysAgo: 15 },
  { name: 'Maliha Noor', doctorEmail: 'nusrat.jahan@careguide.dev', age: 4, gender: 'female', condition: 'Pneumonia', status: 'recovered', admittedDaysAgo: 90 },
  { name: 'Rasel Mia', doctorEmail: 'tanvir.ahmed@careguide.dev', age: 29, gender: 'male', condition: 'Eczema', status: 'active', admittedDaysAgo: 5 },
  { name: 'Farzana Yasmin', doctorEmail: 'tanvir.ahmed@careguide.dev', age: 33, gender: 'female', condition: 'Psoriasis', status: 'under-observation', admittedDaysAgo: 38 },
  { name: 'Abdul Malek', doctorEmail: 'sadia.islam@careguide.dev', age: 67, gender: 'male', condition: 'Lymphoma', status: 'active', admittedDaysAgo: 21 },
  { name: 'Nasima Khatun', doctorEmail: 'sadia.islam@careguide.dev', age: 55, gender: 'female', condition: 'Breast Cancer', status: 'under-observation', admittedDaysAgo: 110 },
  { name: 'Hasibul Islam', doctorEmail: 'rafiqul.karim@careguide.dev', age: 44, gender: 'male', condition: 'Gastritis', status: 'recovered', admittedDaysAgo: 70 },
  { name: 'Ruma Parvin', doctorEmail: 'rafiqul.karim@careguide.dev', age: 38, gender: 'female', condition: 'Ulcer', status: 'active', admittedDaysAgo: 2 },
  { name: 'Mizanur Rahman', doctorEmail: 'mehjabin.chowdhury@careguide.dev', age: 61, gender: 'male', condition: 'Diabetes', status: 'active', admittedDaysAgo: 18 },
  { name: 'Sharmin Sultana', doctorEmail: 'mehjabin.chowdhury@careguide.dev', age: 49, gender: 'female', condition: 'Thyroid Disorder', status: 'discharged', admittedDaysAgo: 130 },
  { name: 'Nazmul Huda', doctorEmail: 'shahriar.kabir@careguide.dev', age: 56, gender: 'male', condition: 'COPD', status: 'under-observation', admittedDaysAgo: 33 },
  { name: 'Ayesha Siddika', doctorEmail: 'shahriar.kabir@careguide.dev', age: 26, gender: 'female', condition: 'Asthma', status: 'recovered', admittedDaysAgo: 150 },
  { name: 'Delwar Hossain', doctorEmail: 'anika.tabassum@careguide.dev', age: 59, gender: 'male', condition: 'Kidney Stones', status: 'active', admittedDaysAgo: 6 },
  { name: 'Sanjida Haque', doctorEmail: 'anika.tabassum@careguide.dev', age: 43, gender: 'female', condition: 'Chronic Kidney Disease', status: 'under-observation', admittedDaysAgo: 95 },
  { name: 'Tofazzal Hossain', doctorEmail: 'mahmudul.hasan@careguide.dev', age: 31, gender: 'male', condition: 'Anxiety Disorder', status: 'active', admittedDaysAgo: 11 },
  { name: 'Rumana Afroz', doctorEmail: 'mahmudul.hasan@careguide.dev', age: 24, gender: 'female', condition: 'Depression', status: 'under-observation', admittedDaysAgo: 52 },
  { name: 'Golam Rabbani', doctorEmail: 'ashfaqul.asif@careguide.dev', age: 72, gender: 'male', condition: 'Heart Failure', status: 'discharged', admittedDaysAgo: 165 },
  { name: 'Sultana Razia', doctorEmail: 'farhana.rahman@careguide.dev', age: 50, gender: 'female', condition: 'Stroke', status: 'recovered', admittedDaysAgo: 175 },
];
