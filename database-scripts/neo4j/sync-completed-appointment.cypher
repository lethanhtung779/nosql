// Driver parameters required:
// customerId, customerName, customerPhone, appointmentId, bookingCode, amount,
// completedAt (ISO-8601), branchId, staffId, staffName.

MERGE (c:Customer {user_id: $customerId})
SET c.name = $customerName, c.phone = $customerPhone
MERGE (a:Appointment {appointment_id: $appointmentId})
SET a.booking_code = $bookingCode, a.amount = $amount, a.completed_at = $completedAt
MERGE (b:Branch {branch_id: $branchId})
MERGE (st:Staff {staff_id: $staffId})
SET st.name = $staffName
MERGE (c)-[:BOOKED]->(a)
MERGE (a)-[:AT_BRANCH]->(b)
MERGE (a)-[:SERVED_BY]->(st);

// Chạy truy vấn sau cho từng dịch vụ với serviceId, name và category.
MATCH (a:Appointment {appointment_id: $appointmentId})
MERGE (s:Service {service_id: $serviceId})
SET s.name = $name, s.category = $category
MERGE (a)-[:INCLUDES]->(s);

