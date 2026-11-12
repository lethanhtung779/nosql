// Tạo lại quan hệ phân khúc từ các Appointment đã đồng bộ vào Neo4j.
MATCH (:Customer)-[old:BELONGS_TO]->(:Segment)
DELETE old;

MATCH (c:Customer)
OPTIONAL MATCH (c)-[:BOOKED]->(a:Appointment)
WITH c,
     count(DISTINCT a) AS appointmentCount,
     sum(coalesce(a.amount, 0)) AS totalSpent,
     max(datetime(a.completed_at)) AS lastVisit,
     count(DISTINCT CASE
       WHEN datetime(a.completed_at) >= datetime() - duration('P90D') THEN a
     END) AS recentCount
CALL {
  WITH c
  OPTIONAL MATCH (c)-[:BOOKED]->(:Appointment)-[:INCLUDES]->(service:Service)
  WITH service.category AS category, count(*) AS uses
  WHERE category IS NOT NULL
  ORDER BY uses DESC, category ASC
  RETURN head(collect(category)) AS favoriteCategory
}
WITH c, appointmentCount, totalSpent, lastVisit, recentCount, favoriteCategory,
     CASE WHEN appointmentCount <= 1 THEN ['Khách mới'] ELSE [] END
     + CASE WHEN recentCount >= 3 THEN ['Khách thường xuyên'] ELSE [] END
     + CASE WHEN appointmentCount >= 10 THEN ['Khách trung thành'] ELSE [] END
     + CASE WHEN totalSpent >= 5000000 THEN ['Khách VIP'] ELSE [] END
     + CASE WHEN lastVisit < datetime() - duration('P90D') THEN ['Nguy cơ rời bỏ'] ELSE [] END
     + CASE WHEN favoriteCategory IS NOT NULL THEN ['Ưa thích: ' + favoriteCategory] ELSE [] END AS segmentNames
UNWIND segmentNames AS segmentName
MERGE (segment:Segment {name: segmentName})
MERGE (c)-[:BELONGS_TO]->(segment)
RETURN c.user_id AS user_id, c.name AS customer, appointmentCount, recentCount,
       totalSpent, lastVisit, collect(segmentName) AS segments
ORDER BY customer;

