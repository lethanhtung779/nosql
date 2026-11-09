import { Injectable, OnModuleDestroy } from '@nestjs/common';
import neo4j, { Driver } from 'neo4j-driver';

@Injectable()
export class Neo4jService implements OnModuleDestroy {
  private readonly driver: Driver;

  constructor() {
    this.driver = neo4j.driver(
      process.env.NEO4J_URI || 'bolt://localhost:7687',
      neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || 'nexasalon-graph')
    );
  }

  async onModuleDestroy() { await this.driver.close(); }

  async ping() {
    const session = this.driver.session();
    try { await session.run('RETURN 1 AS ok'); return true; }
    catch { return false; }
    finally { await session.close(); }
  }

  private async ensureSchema() {
    const session = this.driver.session();
    try {
      await session.run('CREATE CONSTRAINT customer_id IF NOT EXISTS FOR (c:Customer) REQUIRE c.user_id IS UNIQUE');
      await session.run('CREATE CONSTRAINT appointment_id IF NOT EXISTS FOR (a:Appointment) REQUIRE a.appointment_id IS UNIQUE');
      await session.run('CREATE CONSTRAINT service_id IF NOT EXISTS FOR (s:Service) REQUIRE s.service_id IS UNIQUE');
      await session.run('CREATE CONSTRAINT branch_id IF NOT EXISTS FOR (b:Branch) REQUIRE b.branch_id IS UNIQUE');
      await session.run('CREATE CONSTRAINT staff_id IF NOT EXISTS FOR (s:Staff) REQUIRE s.staff_id IS UNIQUE');
      await session.run('CREATE CONSTRAINT segment_name IF NOT EXISTS FOR (s:Segment) REQUIRE s.name IS UNIQUE');
    } finally { await session.close(); }
  }

  async syncAppointment(appointment: any) {
    if (!appointment || appointment.status !== 'COMPLETED') return;
    await this.ensureSchema();
    const data = appointment.toObject ? appointment.toObject() : appointment;
    const session = this.driver.session();
    try {
      await session.run(`
        MERGE (c:Customer {user_id: $customerId}) SET c.name=$customerName, c.phone=$customerPhone
        MERGE (a:Appointment {appointment_id: $appointmentId})
        SET a.booking_code=$bookingCode, a.amount=$amount, a.completed_at=$completedAt
        MERGE (b:Branch {branch_id: $branchId})
        MERGE (st:Staff {staff_id: $staffId}) SET st.name=$staffName
        MERGE (c)-[:BOOKED]->(a)
        MERGE (a)-[:AT_BRANCH]->(b)
        MERGE (a)-[:SERVED_BY]->(st)
      `, {
        customerId: String(data.customer.user_id), customerName: data.customer.name, customerPhone: data.customer.phone,
        appointmentId: String(data._id), bookingCode: data.booking_code, amount: Number(data.total_amount || 0),
        completedAt: new Date(data.completed_at || data.updated_at || Date.now()).toISOString(),
        branchId: String(data.branch_id), staffId: String(data.staff.staff_id), staffName: data.staff.name
      });
      for (const service of data.services_booked || []) {
        await session.run(`
          MATCH (a:Appointment {appointment_id:$appointmentId})
          MERGE (s:Service {service_id:$serviceId}) SET s.name=$name, s.category=$category
          MERGE (a)-[:INCLUDES]->(s)
        `, { appointmentId: String(data._id), serviceId: String(service.service_id), name: service.name, category: service.category || 'Chưa phân loại' });
      }
    } finally { await session.close(); }
  }

  async rebuild(appointments: any[]) {
    await this.ensureSchema();
    const session = this.driver.session();
    try { await session.run('MATCH (n) DETACH DELETE n'); }
    finally { await session.close(); }
    await this.ensureSchema();
    for (const appointment of appointments) await this.syncAppointment(appointment);
    return this.classifyCustomers();
  }

  async classifyCustomers() {
    await this.ensureSchema();
    const session = this.driver.session();
    try {
      const result = await session.run(`
        MATCH (c:Customer)
        OPTIONAL MATCH (c)-[:BOOKED]->(a:Appointment)
        WITH c, collect(DISTINCT {id:a.appointment_id, amount:a.amount, completed_at:a.completed_at}) AS appointments
        OPTIONAL MATCH (c)-[:BOOKED]->(:Appointment)-[:INCLUDES]->(s:Service)
        RETURN c.user_id AS user_id, c.name AS name, c.phone AS phone,
               appointments, collect(s.category) AS categories
        ORDER BY name
      `);
      const now = Date.now();
      const customers = result.records.map(record => {
        const appointments = (record.get('appointments') || []).filter((item: any) => item.id);
        const categories = (record.get('categories') || []).filter(Boolean) as string[];
        const totalSpent = appointments.reduce((sum: number, item: any) => sum + Number(item.amount || 0), 0);
        const dates = appointments.map((item: any) => Date.parse(item.completed_at)).filter(Number.isFinite);
        const lastVisit = dates.length ? new Date(Math.max(...dates)) : null;
        const recentCount = dates.filter((value: number) => now - value <= 90 * 86_400_000).length;
        const segments: string[] = [];
        if (appointments.length <= 1) segments.push('Khách mới');
        if (recentCount >= 3) segments.push('Khách thường xuyên');
        if (appointments.length >= 10) segments.push('Khách trung thành');
        if (totalSpent >= 5_000_000) segments.push('Khách VIP');
        if (lastVisit && now - lastVisit.getTime() > 90 * 86_400_000) segments.push('Nguy cơ rời bỏ');
        if (categories.length) {
          const counts = new Map<string, number>();
          categories.forEach(category => counts.set(category, (counts.get(category) || 0) + 1));
          const preference = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
          if (preference) segments.push(`Ưa thích: ${preference}`);
        }
        return { user_id: record.get('user_id'), name: record.get('name'), phone: record.get('phone'), appointment_count: appointments.length, recent_count: recentCount, total_spent: totalSpent, last_visit: lastVisit?.toISOString() || null, segments };
      });
      for (const customer of customers) {
        await session.run(`
          MATCH (c:Customer {user_id:$userId})
          OPTIONAL MATCH (c)-[old:BELONGS_TO]->(:Segment) DELETE old
          WITH c UNWIND $segments AS segmentName
          MERGE (s:Segment {name:segmentName}) MERGE (c)-[:BELONGS_TO]->(s)
        `, { userId: customer.user_id, segments: customer.segments });
      }
      return customers;
    } finally { await session.close(); }
  }
}
