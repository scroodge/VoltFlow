insert into public.knowledge_categories (slug, title, description, sort_order)
values
  ('charging', 'Charging', 'Home charging, public charging, battery habits, safety, cables, and troubleshooting.', 10),
  ('ownership', 'Ownership', 'Real-owner style experience, first-week habits, comfort, consumption, and trip preparation.', 20),
  ('maintenance', 'Maintenance', 'Owner-level service preparation, symptoms, and safety-aware maintenance notes.', 30),
  ('accessories', 'Accessories', 'Useful ownership items with priorities, risk notes, and search keywords instead of fake product links.', 40),
  ('calculators', 'Calculators', 'EV helper tools for charging time, cost, range, and trip planning.', 50),
  ('battery', 'Battery', 'Battery care, charging limits, cold weather behavior, and daily habits.', 60),
  ('winter', 'Winter', 'Cold-weather charging, range, washer fluid, and winter ownership notes.', 70),
  ('safety', 'Safety', 'Electrical, roadside, child-seat, and service safety topics.', 80),
  ('costs', 'Costs', 'Home charging cost, tariffs, efficiency, and calculator assumptions.', 90),
  ('byd-yuan-up', 'BYD YUAN UP', 'Model-specific ownership and knowledge-base meta topics.', 100)
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  sort_order = excluded.sort_order;

insert into public.knowledge_articles (
  slug, title, summary, category_id, content, tips, warnings, tags, status, source_label, sort_order, published_at
)
values
  (
    'home-charging-basics',
    'Home charging basics',
    'A simple owner-friendly routine for charging BYD YUAN UP at home.',
    (select id from public.knowledge_categories where slug = 'charging'),
    '[{"heading":"What home charging means","body":"Home charging is usually AC charging while the car is parked for several hours. It is the most convenient way to keep the car ready for city driving."},{"heading":"Daily routine","body":"Plug in when the car will sit for a while, set a sensible target if your car or charger supports it, and confirm charging starts before walking away."}]'::jsonb,
    '["Use overnight charging if your electricity plan is cheaper at night.","Check the plug and cable temperature during the first sessions."]'::jsonb,
    '["Use properly rated equipment and a safe grounded circuit."]'::jsonb,
    array['home', 'daily charging', 'AC'],
    'published',
    'Migrated from static Phase 1.5',
    10,
    now()
  ),
  (
    'slow-ac-charging',
    'Slow AC charging',
    'Why slow AC charging is useful for daily ownership.',
    (select id from public.knowledge_categories where slug = 'charging'),
    '[{"heading":"Best use case","body":"Slow AC charging works well when the car is parked overnight or during a long workday. It trades speed for simplicity and lower heat."},{"heading":"Owner expectation","body":"At low power, charging can take many hours. That is normal and not a fault if the car still reaches the target by departure."}]'::jsonb,
    '["Use the calculator to estimate whether overnight charging is enough."]'::jsonb,
    '[]'::jsonb,
    array['slow charging', 'AC', 'battery care'],
    'published',
    'Migrated from static Phase 1.5',
    20,
    now()
  ),
  (
    'battery-care',
    'Battery care',
    'Simple habits that reduce battery stress.',
    (select id from public.knowledge_categories where slug = 'charging'),
    '[{"heading":"Daily use","body":"Many owners use the middle of the battery for daily driving and charge higher only when needed."},{"heading":"Heat and extremes","body":"Avoid leaving the car very low or very high for long periods when you can. Temperature and time both matter."}]'::jsonb,
    '["Stable habits matter more than perfect percentages."]'::jsonb,
    '[]'::jsonb,
    array['battery', 'daily charging', 'health'],
    'published',
    'Migrated from static Phase 1.5',
    30,
    now()
  ),
  (
    'first-week-yuan-up',
    'First week with BYD YUAN UP',
    'A practical owner-style checklist for the first days after delivery.',
    (select id from public.knowledge_categories where slug = 'ownership'),
    '[{"heading":"What owners notice first","body":"The first week is usually about learning charging habits, display menus, driver assistance settings, and how range changes with weather and speed."},{"heading":"Useful first checks","body":"Pair the phone, set preferred charging limits, inspect included cables, check tire pressure, and save trusted charging locations."}]'::jsonb,
    '["Keep a small note of questions for the dealer or service center."]'::jsonb,
    '[]'::jsonb,
    array['owner experience', 'beginner', 'setup'],
    'published',
    'Migrated from static Phase 1.5',
    40,
    now()
  ),
  (
    'maintenance-schedule-overview',
    'Maintenance schedule overview',
    'How to think about routine EV maintenance without guessing service work.',
    (select id from public.knowledge_categories where slug = 'maintenance'),
    '[{"heading":"Owner role","body":"Use the official service schedule for your market. Owners can track dates, mileage, symptoms, tire condition, fluids, and software notes."},{"heading":"EV difference","body":"EVs have fewer engine-related items, but tires, brakes, suspension, cooling, cabin filters, and 12V systems still need attention."}]'::jsonb,
    '[]'::jsonb,
    '["Follow the owner manual and local service guidance first."]'::jsonb,
    array['service', 'schedule', 'maintenance'],
    'published',
    'Migrated from static Phase 1.5',
    50,
    now()
  )
on conflict (slug) do nothing;

insert into public.faq_items (question, answer, category_id, tags, status, sort_order)
values
  ('What is slow charging?', 'Slow charging usually means low-power AC charging from a wallbox, public AC charger, or suitable household socket. It is useful when the car can stay parked for several hours.', (select id from public.knowledge_categories where slug = 'charging'), array['slow charging', 'AC', 'home'], 'published', 10),
  ('Is slow charging better for battery health?', 'Slow AC charging usually creates less heat than frequent high-power DC charging, so it is a good daily habit. Battery temperature and charge level still matter.', (select id from public.knowledge_categories where slug = 'battery'), array['battery health', 'AC'], 'published', 20),
  ('What is the difference between kW and kWh?', 'kW is charging power, like speed. kWh is energy, like the amount added to the battery or used for a trip.', (select id from public.knowledge_categories where slug = 'charging'), array['kW', 'kWh', 'basics'], 'published', 30),
  ('Should I charge to 100% every day?', 'For daily driving, many owners use a lower target such as around 80%. Charge to 100% when you need the range and drive soon after.', (select id from public.knowledge_categories where slug = 'battery'), array['100%', 'daily'], 'published', 40),
  ('How much does home charging cost?', 'Multiply grid energy in kWh by your electricity price. The calculator estimates this using battery change, efficiency, and price.', (select id from public.knowledge_categories where slug = 'costs'), array['cost', 'calculator'], 'published', 50)
on conflict do nothing;

insert into public.accessories (
  title, category_id, use_case, why_useful, what_to_check, priority, risk_notes, search_keywords, status, sort_order
)
values
  ('Type 2 charging cable', (select id from public.knowledge_categories where slug = 'accessories'), 'Public AC chargers that require the driver to bring a cable.', 'Keeps public AC charging options open during city parking or travel.', '["Connector type","Current rating","Cable length","Storage bag"]'::jsonb, 'must-have', '["Buy a cable rated for EV charging, not an unknown generic cable."]'::jsonb, array['Type 2 EV charging cable', 'BYD Yuan Up AC charging cable'], 'published', 10),
  ('Portable EVSE', (select id from public.knowledge_categories where slug = 'accessories'), 'Backup or travel charging from suitable sockets.', 'Helpful when visiting places without a wallbox.', '["Plug type","Adjustable current","Ground protection","Weather rating"]'::jsonb, 'useful', '["Use only on safe grounded outlets suitable for continuous load."]'::jsonb, array['portable EVSE adjustable current', 'portable EV charger grounded'], 'published', 20),
  ('Tire inflator', (select id from public.knowledge_categories where slug = 'safety'), 'Keeping tire pressure correct at home or during trips.', 'Correct pressure helps safety, tire wear, and range.', '["Pressure range","Power source","Gauge accuracy","Hose length"]'::jsonb, 'must-have', '[]'::jsonb, array['portable tire inflator car compressor'], 'published', 30),
  ('Rubber floor mats', (select id from public.knowledge_categories where slug = 'accessories'), 'Protecting the cabin from mud, rain, snow, and family use.', 'Easier cleaning and better long-term interior protection.', '["Exact vehicle fit","Non-slip backing","Pedal clearance","Odor"]'::jsonb, 'useful', '["Mats must not interfere with pedals."]'::jsonb, array['BYD Yuan Up rubber floor mats all weather'], 'published', 40),
  ('Winter washer fluid', (select id from public.knowledge_categories where slug = 'winter'), 'Maintaining visibility in freezing weather.', 'Prevents washer fluid from freezing when temperatures drop.', '["Temperature rating","Local legality","Compatibility"]'::jsonb, 'must-have', '[]'::jsonb, array['winter washer fluid freezing temperature'], 'published', 50)
on conflict do nothing;
