-- ===========================================================================
-- Bo sung ban tieng Anh (en) cho 18 bai tin tuc da import tu thienduccons.vn
-- va cho 4 chuyen muc trong news_categories.
--
-- File nay KHONG chep lai noi dung tieng Viet. No chi chua chuoi EN va ghep
-- vao JSON dang co:
--   * title / summary : merge object  {"vi":...} || {"en":...}
--   * content         : merge theo VI TRI tung doan (join theo ORDINALITY)
-- => VI luon duoc giu nguyen.
--
-- Chi dung UPDATE thuan - KHONG co dollar-quote, DO block hay CREATE FUNCTION -
-- de chay duoc tren moi client SQL (psql, pgAdmin, DBeaver, TablePlus...).
--
-- Idempotent: chay lai nhieu lan van an toan (chi ghi de key "en").
-- Chay sau khi da chay news-thienduccons-import.sql:
--   psql "DATABASE_URL cua ban" -f news-thienduccons-import-en.sql
-- ===========================================================================

-- Don transaction hong con sot lai tu lan chay truoc (loi 25P02 trong pgAdmin).
-- Neu khong co transaction nao dang mo, Postgres chi bao WARNING roi chay tiep.
ROLLBACK;

BEGIN;

-- 1) Chuyen muc -------------------------------------------------------------
UPDATE news_categories SET name = name || '{"en":"Project news"}'::jsonb      WHERE slug = 'tin-du-an';
UPDATE news_categories SET name = name || '{"en":"Company news"}'::jsonb      WHERE slug = 'tin-cong-ty';
UPDATE news_categories SET name = name || '{"en":"Market news"}'::jsonb       WHERE slug = 'tin-thi-truong';
UPDATE news_categories SET name = name || '{"en":"Architecture & Construction"}'::jsonb WHERE slug = 'tin-kien-truc';

-- 2) Bai viet ---------------------------------------------------------------

-- [1] le-khoi-cong-fancy-tower-khu-do-thi-hung-phu (2 doan)
UPDATE news_posts SET
  title   = title   || '{"en":"Fancy Tower Groundbreaking Ceremony | Hung Phu Urban Area"}'::jsonb,
  summary = summary || '{"en":"On 31 March 2021, the Fancy Tower high-end apartment project was officially started. The building stands in the Hung Phu urban area and comprises one basement and 19 above-ground floors with many facilities such as shophouses, a fine-dining restaurant and a swimming pool."}'::jsonb,
  content = (
    SELECT jsonb_agg(t.e || jsonb_build_object('en', a.en) ORDER BY t.i)
    FROM jsonb_array_elements(news_posts.content) WITH ORDINALITY AS t(e, i)
    JOIN jsonb_array_elements_text('[
    "On 31 March 2021, the Fancy Tower high-end apartment project was officially launched. The building is located in the Hung Phu urban area and consists of one basement and 19 above-ground floors with many facilities large and small such as shophouses, a fine-dining restaurant, a swimming pool and more.",
    ">> Detailed information about Fancy Tower"
  ]'::jsonb) WITH ORDINALITY AS a(en, j) ON a.j = t.i
  ),
  updated_at = now()
WHERE slug = 'le-khoi-cong-fancy-tower-khu-do-thi-hung-phu';

-- [2] nhung-mau-thiet-ke-san-thuong-dep (10 doan)
UPDATE news_posts SET
  title   = title   || '{"en":"Beautiful rooftop terrace design ideas"}'::jsonb,
  summary = summary || '{"en":"A rooftop garden with a beautiful natural setting brings a refreshing feeling. The article introduces a series of ideas: a garden on the 25th floor covered with irises and lavender; a terrace with a hot tub for relaxing while watching the city from above; a terrace turned into an outdoor dining area; and a simple, charming rooftop garden full of greenery."}'::jsonb,
  content = (
    SELECT jsonb_agg(t.e || jsonb_build_object('en', a.en) ORDER BY t.i)
    FROM jsonb_array_elements(news_posts.content) WITH ORDINALITY AS t(e, i)
    JOIN jsonb_array_elements_text('[
    "A rooftop garden with a beautiful natural setting will give you a refreshing feeling.",
    "Located on the 25th floor of an apartment building, this beautiful garden is covered with irises and lavender.",
    "This terrace is fitted with a hot tub so the owners can relax and watch the city from above at the same time.",
    "The terrace is designed as an outdoor dining area so the owners can enjoy a meal while taking in the city view.",
    "A simple and charming rooftop garden design with plenty of greenery.",
    "Using plants to cover empty areas brings a cool, green feeling to the terrace.",
    "The terrace is decorated with many flower beds, creating the feeling of being at ground level.",
    "A rooftop garden with a distinctive style.",
    "A terrace designed as an entertainment area.",
    "The terrace is shaded by a wooden slat canopy that reduces heat while creating beautiful streaks of sunlight."
  ]'::jsonb) WITH ORDINALITY AS a(en, j) ON a.j = t.i
  ),
  updated_at = now()
WHERE slug = 'nhung-mau-thiet-ke-san-thuong-dep';

-- [3] nhung-luu-y-de-bai-tri-phong-ngu-hop-phong-thuy (12 doan)
UPDATE news_posts SET
  title   = title   || '{"en":"Notes on arranging a bedroom in line with feng shui"}'::jsonb,
  summary = summary || '{"en":"The bedroom holds a critical position in every home. The article sets out feng shui principles for arranging it: ideally no mirror in the bedroom; avoid furniture with sharp table and bed edges as they weaken the flow of energy, so choose round or oval pieces or have the edges rounded off; plus many notes on accessories and layout to turn the bedroom into a warm, peaceful retreat."}'::jsonb,
  content = (
    SELECT jsonb_agg(t.e || jsonb_build_object('en', a.en) ORDER BY t.i)
    FROM jsonb_array_elements(news_posts.content) WITH ORDINALITY AS t(e, i)
    JOIN jsonb_array_elements_text('[
    "The bedroom holds a critical position in every home. To turn each bedroom into a warm, peaceful and appealing retreat, you can apply the following feng shui principles when arranging it.",
    "Ideally there should be no mirror in the bedroom.",
    "Bedroom accessories",
    "Sharp table and bed edges are believed to weaken the flow of energy gathering around you while you sleep, so you should choose furniture that is round or oval, or at least have those edges sanded smooth and rounded.",
    "Whether you are married or single, bedroom furniture should be arranged in pairs - two bedside tables, two bedside lamps and so on - to create harmony and a sense of completeness.",
    "According to feng shui, the bedroom should have no mirror because mirrors cause light sleep and restlessness. If your room does have a mirror, hide it inside a wardrobe door and never place it facing the bed.",
    "When hanging pictures in the bedroom, avoid images that are sad, unpleasant or irritating. Instead, choose artwork that inspires you or depicts what you want to see in life.",
    "Bedroom colours",
    "Colour affects not only aesthetics but also the feng shui of the bedroom. According to feng shui, bedroom colours should be soft or warm tones such as beige, yellow, peach, coral, brown or light cocoa to help the resting space achieve balance.",
    "Cool tones such as light blue, green and lavender are also considered beneficial for sleep. However, you should not use too many cool tones in the bedroom as they are believed to affect rest negatively. It is best for the room to combine warm and cool tones harmoniously at a ratio of 50% - 50%.",
    "The colours of the mattress, blanket, pillows and curtains should be harmonious and in the same tone as the dominant colour of the bedroom. This creates balance and brings energy to the resting space.",
    "In addition, we should clean the bedroom regularly so that dust has no chance to build up and block the body energy. Do not cram belongings under the bed to save space. Keeping the bedroom clean and tidy is not only good for health but also changes your attitude towards life."
  ]'::jsonb) WITH ORDINALITY AS a(en, j) ON a.j = t.i
  ),
  updated_at = now()
WHERE slug = 'nhung-luu-y-de-bai-tri-phong-ngu-hop-phong-thuy';

-- [4] nha-xay-san-xu-huong-moi-cua-bat-dong-san-vung-ven-tphcm (4 doan)
UPDATE news_posts SET
  title   = title   || '{"en":"Ready-built houses - a new trend in the suburban property market of Ho Chi Minh City"}'::jsonb,
  summary = summary || '{"en":"Private residential land has always been a favoured segment, but because many buyers lack expertise and time to manage construction, they choose ready-built houses instead. Advantages: move in right after purchase, a brand-new house close to central areas at a reasonable price; whereas buying land and building yourself pushes costs up, not to mention permits, design, material selection and site supervision."}'::jsonb,
  content = (
    SELECT jsonb_agg(t.e || jsonb_build_object('en', a.en) ORDER BY t.i)
    FROM jsonb_array_elements(news_posts.content) WITH ORDINALITY AS t(e, i)
    JOIN jsonb_array_elements_text('[
    "Private residential land has always been a real estate segment favoured by many Vietnamese. However, because they lack expertise and time to manage construction, many people have chosen to buy ready-built houses instead.",
    "Mr. Le Van Hoc, who has just acquired a brand-new house in District 12, shares: the advantage of this type of house is that you can move in right after the purchase; it is a new house close to central areas at a reasonable price. Buying land and building yourself pushes the cost much higher, not to mention that construction permits, design, material selection and site supervision are all cumbersome and complicated. Above all it takes time and affects your work. It is true that building your own house lets you have it your way, but the cost is very high, and that becomes difficult when your savings are not enough and you have to borrow. You then carry debt when, with that same amount of money, buying a ready-built house would have cost you nothing extra, Mr. Hoc says.",
    "Ready-built houses are always sought after by buyers",
    "For the same reasons as Mr. Hoc gives, this type of house has a certain appeal in the Ho Chi Minh City property market. In the first 10 months of 2015, thousands of ready-built houses were sold in suburban districts such as Go Vap, Thu Duc, District 12, Hoc Mon, Binh Chanh and Nha Be. Mr. Doan Van Ninh, General Director of Van Xuan Real Estate, one of the companies specialising in ready-built houses in the suburban market of District 12 and Go Vap, says: the advantages of ready-built houses are synchronous, modern infrastructure and reasonable prices. Because they are built in series, labour costs are saved and the time and paperwork for land and housing procedures are reduced. Buyers only need to prepare the money and move in on the agreed day; all land and housing paperwork is handled by the developer. As a real estate business we pay even more attention to our reputation, because a company that wants sustainable growth must meet the demanding needs of customers through quality, credibility and reasonable pricing, Mr. Ninh stresses."
  ]'::jsonb) WITH ORDINALITY AS a(en, j) ON a.j = t.i
  ),
  updated_at = now()
WHERE slug = 'nha-xay-san-xu-huong-moi-cua-bat-dong-san-vung-ven-tphcm';

-- [5] ngoi-nha-cua-nang-luong-thiet-ke-bg-architekture (4 doan)
UPDATE news_posts SET
  title   = title   || '{"en":"House of Energy / design: BG Architekture"}'::jsonb,
  summary = summary || '{"en":"The world first certified passive house in Germany exceeds the EU energy directives that apply to all new buildings from 2021. The 900 sq.m building, named House of Energy, has a heating demand of only 8 kWh per sq.m, an airtight facade, heat-recovery ventilation, a ground-source heat pump and a photovoltaic system."}'::jsonb,
  content = (
    SELECT jsonb_agg(t.e || jsonb_build_object('en', a.en) ORDER BY t.i)
    FROM jsonb_array_elements(news_posts.content) WITH ORDINALITY AS t(e, i)
    JOIN jsonb_array_elements_text('[
    "As the world first certified passive house in Germany, having exceeded the EU energy directives that apply to all new buildings from 2021, this building uses a mix of efficient energy solutions with a heating demand of 8 kWh per square metre and boasts excellent thermal protection, an airtight facade, heat-recovery ventilation, a ground-source heat pump and a photovoltaic system. This exceptional building will open to the public this month.",
    "The 900 sq.m building is officially called the House of Energy and hosts many functions such as office space for a training centre, exhibition areas and an apartment. Directed by Markus Mayer and his company AIROPTIMA, and designed by architect Barbara Glantschnig of BG Architekture, the House of Energy combines pioneering technology with a fully insulated building structure to give occupants a sustainable and comfortable place to stay.",
    "It draws energy from probes deep in the ground and produces energy for the heat pump, ventilation equipment and general electricity consumption by harvesting solar energy through a 250 sq.m photovoltaic system installed on the roof. The photovoltaic system actually generates two to three times more energy each year than the building consumes.",
    "Inside, the house features smart screens that provide information on energy use, temperature and other important functions. Seven touch panels are installed in the individual office areas and control the operation of the heating, lighting, cooling and ventilation systems. These technologies, including climate sensors, can also be controlled remotely via mobile devices and smartphones."
  ]'::jsonb) WITH ORDINALITY AS a(en, j) ON a.j = t.i
  ),
  updated_at = now()
WHERE slug = 'ngoi-nha-cua-nang-luong-thiet-ke-bg-architekture';

-- [6] nhung-trung-tam-hanh-chinh-nghin-ty-dong (48 doan)
UPDATE news_posts SET
  title   = title   || '{"en":"Administrative centres worth thousands of billions of dong"}'::jsonb,
  summary = summary || '{"en":"To bring all state agencies under one roof and make administrative and public transactions easier for citizens, many provinces and cities have built administrative centres costing thousands of billions of dong."}'::jsonb,
  content = (
    SELECT jsonb_agg(t.e || jsonb_build_object('en', a.en) ORDER BY t.i)
    FROM jsonb_array_elements(news_posts.content) WITH ORDINALITY AS t(e, i)
    JOIN jsonb_array_elements_text('[
    "To bring all state agencies under one roof and make administrative and public transactions easier for citizens, many provinces and cities have built administrative centres costing thousands of billions of dong.",
    "1. The administrative centre of more than 500 billion dong in Lai Chau",
    "With a total investment of 554 billion dong, Lai Chau has an imposing administrative centre with landscaping regarded as superb, set on a high, dry hill covering 5 hectares. In front of the centre are the People Square and the provincial Cultural Conference Centre. This was also the first locality in the country to have a concentrated administrative centre, put into use in 2009 to mark the 100th anniversary of the founding of the province.",
    "The centre consists of six substantial buildings (two nine-storey blocks and four seven-storey blocks) housing the People Council, the People Committee and 36 provincial administrative agencies, units and Party bodies.",
    "2. The administrative centre of more than 1,000 billion dong in Ba Ria - Vung Tau province",
    "The administrative centre of Ba Ria - Vung Tau province in Phuoc Trung ward (Ba Ria city), on a site of about 20 hectares, has been in operation since April 2012 with a total investment of more than 1,000 billion dong from the provincial budget. Part of the budget will be recovered when the province auctions the former headquarters of its departments in Vung Tau city.",
    "The centre was newly planned and invested in a concentrated, modern model with seven clusters of office buildings, each six storeys high, serving all administrative and state functions of the province. Bringing all departments to one place aims to create favourable conditions for organisations and citizens to carry out administrative transactions, contact the authorities and handle related matters.",
    "3. The 1,400 billion dong administrative building in Binh Duong",
    "The concentrated administrative centre of Binh Duong province was built in Phu Hoa ward, Thu Dau Mot city (about 9 km from the old headquarters), within Binh Duong New City. Inaugurated in February 2014, the concentrated administrative centre of Binh Duong province is 104 metres high, has a helipad and a total investment of 1,400 billion dong.",
    "The administrative centre comprises twin towers A and B with a floor area of 104,000 sq.m, 21 storeys high (excluding two basements) and a helipad designed by a Singaporean company. In front of the administrative centre is a large yard with wide lawns. Beyond it lies the newly completed Binh Duong New City park. Behind the building is the largest roundabout in Southeast Asia, connecting the main axes of the gradually completed New City.",
    "4. The administrative centre of more than 2,300 billion dong in Da Nang",
    "The Da Nang City Administrative Centre at 24 Tran Phu, Thach Thang ward, Hai Chau district, started construction in November 2008 with a total construction investment of 2,321 billion dong and is shaped like a lighthouse facing the sea. After several extensions, the building was put into partial operation from late July 2014 and has now begun full operation serving the public.",
    "The top of the tower is built with a steel structure clad in glass for technical systems and is expected to become an entertainment area for viewing Da Nang from above. The building has 13 lifts (three serving the podium and 10 serving the tower) divided into three groups and operated by intelligent software.",
    "5. The administrative centre of more than 1,000 billion dong in Lam Dong",
    "On 23 April 2015, the administrative centre of Lam Dong province, located right in the centre of Da Lat city, was officially inaugurated. The project was approved with a total investment of 1,014 billion dong from the state budget.",
    "Started at the end of 2009, the complex comprises a nine-storey block and a six-storey block with three basements, a total construction area of 13,126 sq.m and a total floor area of 56,171 sq.m. The Lam Dong administrative centre is the workplace of some 1,400 officials from 49 departments and public service units under the province.",
    "6. Hai Phong builds a new administrative centre of nearly 10,000 billion dong",
    "The project to build technical infrastructure for the city administrative and political centre covers 324 hectares in Thuy Nguyen district and Hong Bang district, with a total investment of 9,894 billion dong, of which nearly 6,855 billion comes from the central budget and the rest from the Hai Phong city budget and other lawful sources.",
    "Perspective view of the new administrative and political centre of Hai Phong city on the northern bank of the Cam river.",
    "The project runs from 2015 to 2020 in three phases: project preparation (completed in 2015); implementation (2016 to 2019); and completion of construction and handover for use in 2020.",
    "To date the city has completed several tasks such as surveying the current state of the project site; preparing the compensation, support and resettlement plan; and drawing up, appraising and approving the tasks, cost estimates and contractor selection plan. The project has received in-principle approval from the Prime Minister and is being reviewed and appraised by the ministries and agencies as required.",
    "7. Khanh Hoa spends 4,300 billion dong on a bird-nest-shaped administrative centre",
    "The project covers a total planning area of 126 hectares in Vinh Thai commune, Nha Trang city. Of this, the concentrated administrative centre occupies 37 hectares and the remaining 89 hectares are commercial housing and office services. The maximum number of users across the whole area is 5,000. Total investment is estimated at nearly 4,300 billion dong, of which infrastructure and architectural works for the administrative centre alone account for more than 3,000 billion.",
    "The new administrative urban centre of Khanh Hoa is expected to be built in the shape of a bird nest, with the government building modelled as a giant hatching egg.",
    "Model of the new administrative urban centre of Khanh Hoa province.",
    "The Khanh Hoa government building is shaped like a giant hatching egg.",
    "The provincial People Committee has issued a document assigning a company to carry out site clearance, levelling and infrastructure investment for the whole urban area, including roads and several works. The province will then hand over land plots at Nha Trang airport to repay that company.",
    "The Government has approved in principle the use of the build-transfer contract form for the Khanh Hoa People Committee to implement the administrative urban centre project.",
    "8. More than 2,000 billion dong for the concentrated administrative centre of Hai Duong",
    "The Prime Minister has allowed Hai Duong province to build a 19.5-hectare provincial administrative centre under the BT (build-transfer) form in the new urban area east of Hai Duong city, with a total investment of about 2,060 billion dong. Of this, about 1,000 billion dong comes from the provincial budget; about 200 billion dong from the sale of assets on land and the transfer of land use rights of former public offices; and the rest from land use revenues of several projects in the province.",
    "By design, the concentrated administrative centre of Hai Duong includes five areas: the headquarters of the People Council, the People Committee and the provincial National Assembly delegation; the working area for departments and agencies under the provincial People Committee; a conference centre; internal roads, greenery, a square, car parks and external technical infrastructure; and a service area. It will be the concentrated workplace of 19 state management agencies and provincial authorities.",
    "9. Nghe An builds an administrative centre of more than 2,100 billion dong",
    "The preliminary planning option selected a site adjoining Le Nin Avenue (Vinh city) and the Le Hong Phong - Le Nin Avenue roundabout, covering about 3.77 hectares, for the concentrated administrative complex. The complex comprises two 27-storey towers, 106 m high, linked by a bridge at floors 21-22, with workspace for 1,700 people. The total estimated cost is more than 2,100 billion dong.",
    "The complex is regarded as having an exceptional design unlike any other building in Vietnam, sitting on a planned site of more than 52,000 sq.m, of which the construction area is more than 10,000 sq.m, right next to the Le Nin Avenue roundabout. The Government has agreed in principle for Nghe An to build this administrative centre.",
    "10. Ha Tinh wants to build a 1,500 billion dong administrative centre",
    "The People Committee of Ha Tinh province is planning to build an administrative centre with an estimated investment of 1,500 billion dong. The project will be divided into two phases. Ha Tinh first wants to carry out phase 1 (technical infrastructure and the first high-rise building providing workspace for eight to ten departments and agencies) with a budget of 800 billion dong.",
    "The intended project area is 46 hectares, of which the administrative centre building accounts for 10 hectares and the remaining 36 hectares are planned as urban functional zones. The works are expected to be completed in 2017.",
    "The current headquarters of the People Committee of Ha Tinh province.",
    "Funding for this project will come from the provincial budget; from the sale and auction of land within the 36 hectares (outside the 10 hectares for the administrative centre); from the sale of the headquarters to be relocated; and from other lawful sources.",
    "11. Thai Binh builds a 2,000 billion dong administrative centre",
    "Under the decision of Prime Minister Nguyen Tan Dung, the Government agreed in principle and asked the People Committee of Thai Binh province to review its land use plan and the current state of agency headquarters; and to determine an appropriate scale for the administrative and political centre based on the standards for headquarters use and the staffing orientation of state administrative agencies.",
    "The current headquarters of the People Committee of Thai Binh province",
    "According to the People Committee of Thai Binh province, the provincial Administrative and Political Centre is expected to be built in Hoang Dieu urban area (Thai Binh city). The centre will be built on an area of about 12 to 15 hectares, comprising two to three blocks serving as the workplace of Party bodies, administrative agencies, mass organisations and public service units under the departments and agencies. The project investment is about 2,000 billion dong.",
    "12. Ho Chi Minh City settles on the design for its administrative centre on prime land",
    "The city People Committee leaders have agreed with the experts and selected the proposal of a Japanese company as the design scheme for the administrative centre of the Ho Chi Minh City People Committee. Under the plan, the Ho Chi Minh City Administrative Centre covers 18,000 sq.m bounded by four streets - Le Thanh Ton, Pasteur, Ly Tu Trong and Dong Khoi - and will be the workplace of eight state agencies with 90 subordinate divisions totalling about 1,700 people.",
    "The selected design scheme for the Ho Chi Minh City Administrative Centre.",
    "The Ho Chi Minh City Administrative Centre is bounded by four streets - Le Thanh Ton, Pasteur, Ly Tu Trong and Dong Khoi - in Ben Nghe ward, District 1.",
    "The agencies to be located in the administrative centre once completed include: the Office of the City People Committee, the Office of the National Assembly Delegation and the City People Council, the Department of Home Affairs, the Department of Information and Communications, the Department of Industry and Trade, the Enterprise Renovation Board, the Department of Natural Resources and Environment and the Department of Transport."
  ]'::jsonb) WITH ORDINALITY AS a(en, j) ON a.j = t.i
  ),
  updated_at = now()
WHERE slug = 'nhung-trung-tam-hanh-chinh-nghin-ty-dong';

-- [7] thiet-ke-nha-34m-tren-dat-no-hau (24 doan)
UPDATE news_posts SET
  title   = title   || '{"en":"Designing a 34 sq.m house on a plot that widens at the rear"}'::jsonb,
  summary = summary || '{"en":"Architectural advice for a 34 sq.m plot in an alley (3 m frontage, widening to 4.5 m at the rear, 9 m deep) for five adults: ground floor with living room, kitchen, toilet and parking for three motorbikes; mezzanine with one bedroom and a toilet; second floor with two bedrooms and a toilet; roof level with a Guanyin statue and a drying yard. The architect proposes a modern, airy layout."}'::jsonb,
  content = (
    SELECT jsonb_agg(t.e || jsonb_build_object('en', a.en) ORDER BY t.i)
    FROM jsonb_array_elements(news_posts.content) WITH ORDINALITY AS t(e, i)
    JOIN jsonb_array_elements_text('[
    "My family has a plot in an alley of 34 square metres (3 m frontage, widening to 4.5 m at the rear, 9 m deep). We now intend to build a house for five adults with the following spaces:",
    "- Ground floor: living room, kitchen, toilet and parking for three motorbikes",
    "- Mezzanine: one bedroom and a toilet",
    "- Second floor: two bedrooms and a toilet",
    "- Roof level: a place for a Guanyin statue and a drying yard",
    "I hope the architects can advise us so that our family has a modern, comfortable and airy living space. (Linh Chi, Ho Chi Minh City)",
    "The architect advises:",
    "Based on the information you provided and your requirements for the house, we propose the following interior layout for your reference.",
    "Ground floor plan.",
    "Mezzanine plan.",
    "Second floor plan",
    "Roof level plan",
    "The ground floor accommodates a fully equipped living room with parking for three motorbikes, an airy kitchen and a charming dining set for five. The toilet is placed under the staircase to save space. The mezzanine has a bedroom and a separate toilet. The second floor accommodates two bedrooms and one shared toilet.",
    "So that the rear of the house does not feel stuffy, we propose a skylight at the end of the plot where the land is cut at an angle. This design keeps the bedroom rectangular while bringing light and ventilation to the toilet. At roof level, the front is the area for the Guanyin statue and the rear is the drying yard.",
    "You should choose bright tones as the dominant colours because they make your living space feel more spacious and clean. You can refer to the colour schemes and interior arrangements below to find the best solution for your house.",
    "A slim, modern sofa design suits a small living room well",
    "A yellow sofa set and colourful picture frames create a focal point for the living room.",
    "White and pastel grey tones bring a gentle feel to the bedroom.",
    "Red used in moderation makes the bedroom warmer and more lively.",
    "A tidy kitchen with wooden furniture.",
    "A kitchen that doubles as storage.",
    "A small but tidy kitchen thanks to a smart cabinet system.",
    "A bathroom with compact modern fittings.",
    "Black and white is a modern palette that brings a clean feel to the bathroom."
  ]'::jsonb) WITH ORDINALITY AS a(en, j) ON a.j = t.i
  ),
  updated_at = now()
WHERE slug = 'thiet-ke-nha-34m-tren-dat-no-hau';

-- [8] ly-luan-phe-binh-kien-truc... (21 doan)
UPDATE news_posts SET
  title   = title   || '{"en":"Architectural theory and criticism: linking theory with practice and the values of identity"}'::jsonb,
  summary = summary || '{"en":"Architectural criticism in specialist journals has taken issue with many trends of garish, alien construction that damage cultural identity. Meanwhile, architectural theory remains weaker than criticism; only with theory do the steps taken follow the right direction and prove effective. The article argues that architectural criticism and theory must go one step ahead to contribute to the development of the profession."}'::jsonb,
  content = (
    SELECT jsonb_agg(t.e || jsonb_build_object('en', a.en) ORDER BY t.i)
    FROM jsonb_array_elements(news_posts.content) WITH ORDINALITY AS t(e, i)
    JOIN jsonb_array_elements_text('[
    "Architectural criticism in specialist journals has also taken issue with many trends of garish and alien construction that damage cultural identity in many parts of our country. Architectural theory is a field somewhat weaker than architectural criticism. We have not yet recognised the importance of theory, because in practice it is theory that keeps our steps on the right course and makes them effective. To contribute effectively to the overall development of the architectural profession, criticism and theory must go one step ahead, based on rigorous, scientific development strategies that link theory with practice and, above all, identify and uphold the values of identity.",
    "Houses imitating classical French architecture spreading through our cities are being strongly criticised",
    "The current state of theory and criticism",
    "Our architectural theory and criticism has long been assessed as weak, not matching the strong development of design and construction across the country. Let us review a few aspects of this issue.",
    "1. On architectural criticism, the most prominent criticism in recent years has been of the French architecture syndrome. Articles criticising this phenomenon have appeared in specialist architectural journals and daily newspapers, and many have been broadcast on radio and television. This is a hybrid architecture, a mass of fake Western antiquity spreading across self-built houses along the streets, gradually forming a new folk architecture of the city. During this period, some large state-built works also followed the syndrome. Its hallmarks are facades with Greco-Roman triangular pediments and plaster reliefs. Beneath the pediment are columns in the classical Greco-Roman orders, but rendered incorrectly through lack of understanding. Roman-style gateways are built at many villas and at the entrances to new urban areas as Roman triumphal arches. The domes on the roof of the Hanoi Opera House were much favoured in this period. Such domes were built in the city and along the roads from Hanoi to Vinh Phuc, from Ha Dong to Van Dinh, and in towns throughout the North. They can even be seen along the road to the central region. The trapezoidal Mansart roof was also popular; there is even an entire vast urban area (The Manor - My Dinh) using this roof type throughout its high-rise buildings. The French Mansart roof is covered with metal tiles, sometimes painted red. Such phenomena are imitations of classical Western architecture. We call for a fight against fake and shoddy goods, yet here this fake Western merchandise openly adorns our cities.",
    "Within the French architecture syndrome there is also the phenomenon of imitating French vernacular houses with steeply pitched roofs, chimneys rising from the roof, triangular gables with deep eaves and many wooden brackets supporting the roof, and bull-eye windows on the roof and gables. Through specialist journals, architectural critics have taken various approaches to voice criticism of this pseudo-classical imitation, for example by publishing sections of several large works at central and local level that were about to be built to gather the opinions of experts and readers. Regrettably, despite strong criticism, these works have still been built and stand openly in the city. Even so, criticism has not been without effect. The Opera House domes have largely stopped appearing in the city; they have shifted to the countryside at a smaller scale.",
    "Besides articles criticising the French architecture syndrome, architectural criticism in the journals has also addressed many trends of garish and alien construction damaging cultural identity in many parts of our country. Most concretely, critical articles have identified and clarified the nature of hot issues such as the inadequate and failed symbolism of many supermarkets and large shopping centres built in cities nationwide. From Hanoi to Ho Chi Minh City and in most provinces, people do not go to the vast shopping centres and instead miss the markets that were demolished to build them. Many articles have analysed the causes and nature of this phenomenon and proposed directions for resolving it from multidisciplinary perspectives such as architecture, planning, socio-culture, heritage conservation and urban development.",
    "A second hot issue that critics have addressed extensively is social housing. Although there have been a number of notable articles, given the importance of the issue to society the criticism still seems light and shallow and has not yet produced effective solutions. The same is true of resettlement housing, where only external phenomena have been touched upon without focus.",
    "On green architecture, critics have devoted much attention. Through shared critical contributions, we have recently seen a Green Architecture manifesto, criteria for green architecture, green architecture competitions and many green architecture exhibitions, making the movement vigorous and having a good effect on creation, design and construction.",
    "As for the new rural development programme, criticism at present is far too limited. For a long time the architectural community all but forgot the countryside. Only since the directive on new rural construction has the profession begun to return to this issue, but still superficially and without depth. Specific solutions are still lacking, even though about half of the 19 new rural criteria relate to planning and architecture - and with that volume of work, the profession has a great deal to do to help our countryside move forward.",
    "The conservation and restoration of ancient architectural works and old quarters is also a topic where criticism is much needed. However, in this area too there are few in-depth and pertinent critical articles.",
    "The training of architects has been addressed with relatively more lively criticism in recent times. Critical articles on architectural education and introductions to training methods abroad have drawn public interest towards reform and improvement in the study and teaching of architecture. However, with more than 20 universities in the country training architects and teaching that varies widely - from traditional apprenticeship to studio-based learning and workshops - the quality of graduating architects is still not readily accepted by the actual labour market, and unemployment after graduation is fairly common. Such critical comments on training methods have not yet had an effect.",
    "2. On architectural theory, it can be said that theory is a field somewhat weaker than criticism. We have not yet recognised the importance of theory, because in practice it is theory that keeps our steps on the right course and makes them effective.",
    "At university we have not taught students the most basic and important theories of architecture and urban planning. Such theories must be illustrated with concrete examples, so that theory goes hand in hand with practice and the resulting design has a soul and an identity. Reviewing the published materials on architectural and planning theory, we find only two books: Architectural Theory by Prof. Dr. Arch. Nguyen Manh Thu and Prof. Dr. Arch. Phung Duc Tuan (published in 2002) and the General Architectural Theory textbook by Prof. Dr. Arch. Dang Thai Hoang and Assoc. Prof. Dr. Arch. Nguyen Dinh Thi (published in 2013). These two slim books are a precious asset giving architects a summary of the main theories of urban planning and architecture that the great minds of world architecture have produced throughout the course of history. Besides theories from centuries past, modern theories of architecture and urban planning are also presented. However, both books still leave sizeable gaps, especially regarding very important theories already applied in many countries and even in ours. For example, the architectural theory book still lacks the canonical theories of Ebenezer Howard garden city, Raymond Unwin satellite city, Tony Garnier industrial city, Soria y Mata linear city and the city of Camillo Sitte. It says nothing of Clarence Perry neighbourhood unit theory, an urban theory widely applied in Hanoi and Vinh. The General Architectural Theory textbook also omits the cities of the utopians Fourier and Godin. Neither book on architectural theory mentions modern and very recent theories such as the Ekistics of Doxiadis. This Greek architect had produced a scheme for the city of Saigon before 1975. The famous theory a city is not a tree by Christopher Alexander broke the hierarchical system of Clarence Perry, and we are now struggling with the consequences of the neighbourhood units of the 1970s. The General Architectural Theory textbook does mention Clarence Perry, but in only two pages, saying nothing significant about a theory that our architecture and planning profession applied for more than two decades. The postmodern theories of Charles Jencks, the anti-tradition theory of Kenzo Tange and the theories of symbiotic architecture and metabolism are not presented at all.",
    "Overall, in the current context, because we somewhat underrate theory, design work has no foundation on which to build its creativity.",
    "Orientations for developing architectural theory and criticism",
    "To contribute effectively to the overall development of the architectural profession, criticism and theory must go one step ahead, based on rigorous, scientific development strategies that link theory with practice and, above all, identify and uphold the values of identity. First of all, we need to update the systems of theory that build architectural identity and sustainable development for Vietnamese architecture.",
    "One theory with a very strong influence in the international architectural community is the theory of place. It emerged in the mid-twentieth century from architecture and urban planning and developed strongly as a reaction to the Le Corbusier urban model, which was utilitarian, erased local character and tended towards globalisation. The theory of place brings identity to architecture. Many architects have developed it, such as Kevin Lynch, Jane Jacobs, William Whyte and Alexander, and have introduced concepts such as placemaking and the spirit of place, emphasising identity in urban architecture.",
    "Besides the theory of place, the theory of ecological architecture also gives architecture a clear identity. There is natural ecology and human ecology; architecture and urban planning that meet these two ecological requirements naturally take on local colour in both material and spiritual terms and therefore have their own identity, quite different from other places. That is what makes them national in character.",
    "Combining the two theories of place and ecological architecture is a reasonable and effective direction for the future of Vietnamese architecture, ensuring a rich Vietnamese identity. Looking back at history, our forefathers applied these theories for generations: using geomancy to choose sites for houses and villages, and arranging the grounds of the house in harmony with the natural landscape, abundant vegetation, ponds and shade. They made the most of the advantages of place, created a spirit of place and a perfect ecological environment. This is therefore the right path our forefathers took, and we need only walk along it. It is traditional yet modern.",
    "There is one more issue: for the identity of Vietnamese architecture to be rich and distinctive, we must think deeply to find what is most Vietnamese and express it in our creations. That must be the lesson of Japan as expressed in the works of Kenzo Tange, Kisho Kurokawa and Tadao Ando. It is the quality of zen, the essence of tradition distilled - or inverted, as in the anti-tradition theory of Kenzo Tange. That is not easy; we need to understand Vietnam and ourselves far better, because a rich identity for Vietnamese architecture cannot be achieved superficially or easily./."
  ]'::jsonb) WITH ORDINALITY AS a(en, j) ON a.j = t.i
  ),
  updated_at = now()
WHERE slug = 'ly-luan-phe-binh-kien-truc-gan-ly-thuyet-voi-thuc-tien-va-gia-tri-ban-sac';

-- [9] gach-chu-u-giai-phap-moi-danh-cho-tuong-xay-ben-vung (3 doan)
UPDATE news_posts SET
  title   = title   || '{"en":"U-shaped block - a new solution for durable masonry walls"}'::jsonb,
  summary = summary || '{"en":"While cooperating with the Vietnam Institute for Building Science and Technology IBST (Ministry of Construction) to develop the standard for the execution and acceptance of concrete masonry unit walls, Khang Minh Brick JSC observed that foreign contractors, especially Japanese ones, often add bond beams and columns to make large walls more durable. U-shaped concrete masonry units are a suitable solution for building bond beams."}'::jsonb,
  content = (
    SELECT jsonb_agg(t.e || jsonb_build_object('en', a.en) ORDER BY t.i)
    FROM jsonb_array_elements(news_posts.content) WITH ORDINALITY AS t(e, i)
    JOIN jsonb_array_elements_text('[
    "In recent times, while cooperating with the Vietnam Institute for Building Science and Technology IBST (Ministry of Construction) to issue the set of standards guiding the execution and acceptance of walls built with concrete masonry units, Khang Minh Brick Joint Stock Company observed that most foreign construction contractors and design and construction consultants, especially Japanese ones, apply the solution of adding bond beams and columns to give large walls a firmer and more durable structure.",
    "In foreign literature and construction practice, concrete masonry units used to build bond beams are U-shaped, which is very convenient for tying reinforcement and pouring concrete. Quick to grasp, inherit and promote a spirit of learning and creativity, Khang Minh invested in moulds and launched a range of U-shaped units in various sizes corresponding to the specific wall thicknesses used in Vietnam. This product range is applied in place of door and window lintels to form a continuous concrete band that makes the masonry firm and durable. The product is especially useful in the construction of high-rise buildings.",
    "The U-shaped product group speaks for a commitment to continuous learning, exploration and responsibility, delivering durable masonry and flexible construction solutions for building projects."
  ]'::jsonb) WITH ORDINALITY AS a(en, j) ON a.j = t.i
  ),
  updated_at = now()
WHERE slug = 'gach-chu-u-giai-phap-moi-danh-cho-tuong-xay-ben-vung';

-- [10] di-tich-quoc-gia-lang-co-duong-lam (20 doan)
UPDATE news_posts SET
  title   = title   || '{"en":"National Relic - Duong Lam ancient village"}'::jsonb,
  summary = summary || '{"en":"Duong Lam ancient village embodies the full cultural values of an old Vietnamese village with its banyan tree, well, communal house yard and laterite houses hundreds of years old; it is also the land of two kings, with temples to Phung Hung and Ngo Quyen. The village lies about 47 km west of Hanoi and 5 km from the centre of Son Tay town, and brings together five hamlets: Mong Phu, Cam Thinh, Dong Sang, Doai Giap and Cam Lam."}'::jsonb,
  content = (
    SELECT jsonb_agg(t.e || jsonb_build_object('en', a.en) ORDER BY t.i)
    FROM jsonb_array_elements(news_posts.content) WITH ORDINALITY AS t(e, i)
    JOIN jsonb_array_elements_text('[
    "Duong Lam ancient village embodies the full cultural values of an old Vietnamese village with its banyan tree, well, communal house yard and laterite houses hundreds of years old. More than that, this is the land of two kings, with two temples dedicated to Phung Hung and Ngo Quyen. By any measure this is regarded as a representative ancient village of the whole country.",
    "Lying about 47 km west of Hanoi and 5 km from the administrative centre of Son Tay town, Duong Lam ancient village brings together five of the nine hamlets of Duong Lam commune, Son Tay town: Mong Phu, Cam Thinh, Dong Sang, Doai Giap and Cam Lam, with a natural area of about 800.25 hectares and a population of more than 8,000.",
    "Duong Lam is a land of sacred spirit and talented people, birthplace of two kings and national heroes: Bo Cai Dai Vuong Phung Hung (?-789) and Ngo Quyen (898-944). Phung Hung made great contributions to the struggle against Tang domination in the eighth century. Ngo Quyen commanded the victory over the Southern Han on the Bach Dang river, completing the struggle for liberation and winning independence for the country in 938, opening the era of independent feudal rule in Vietnamese history.",
    "Beyond two village gates weathered by wind and rain, standing under the shade of a giant 300-year-old banyan tree, lie lanes, village roads, tiled roofs, laterite walls and ancient architectural works within a communal living space imbued with the character of a purely agricultural village and the imprint of a wet rice civilisation.",
    "Visitors from afar easily recognise the special feature of Duong Lam ancient village: timber houses with laterite walls, set in compounds also enclosed by laterite walls, with village lanes paved in bricks laid on edge running between them.",
    "The details that make up the soul of the old houses include laterite walls, laterite gates, paths paved with bricks on edge, high door sills and the ancestral altar space.",
    "The houses lie hidden, their mossy fish-scale tiles forming a sagging line (like the back of the old pigs of the northern delta). Attached to the house are a yard, garden, kitchen, side house, well, livestock and poultry sheds, a screen wall, a pond, a straw stack and a covered gate with a round turning handle.",
    "These houses were built with the traditional materials of the Doai region: laterite (forming the walls, keeping the house cool in summer and warm in winter), bamboo, chinaberry wood, reed, fired earth bricks, rammed earth, rice husk, mud, sawdust, lime, sand, slag and straw. Better-off families used the four precious timbers (dinh - lim - sen - tau).",
    "The house is laid out on five rows of columns, in a model of five or seven bays with two side compartments; with a system of side doors and folding or shop-style door leaves. A carpenter measure rule is often placed at the main beam of the ceiling, and the ridge purlin bears the carved date; the panels and door arches are where meticulous decorative motifs are carved. The central bay, occupying the largest area, houses the ancestral altar.",
    "Along with it are the horizontal lacquered boards, parallel sentences, old paintings, worship objects and relics of ancestors, with a wooden plank bed placed below for sitting. There is often also a set of long benches. On the table almost every house has a teapot in a basket keeping green tea warm for guests, or sometimes a bowl pipe or a bamboo pipe for smoking.",
    "The house gate is basket-handle shaped, soft in line yet solid thanks to the laterite. Mandarin houses often had door rings with a mask motif, topped with images of the dragon, unicorn, tortoise and phoenix, or two dragons flanking the moon. Each house is a family treasure, a piece of history and culture and a sacred place of worship for each lineage.",
    "The aged folding door panels, usually creaking shut on a private world,",
    "are laid out as a table whenever there is an occasion",
    "The houses in the village all follow the inner-worship, outer-guest layout, with the yard lower than the road so that on rainy days water flows from outside into the yard (water gathering brings fortune) before draining out to the sewer.",
    "The lanes in the village are all dead ends as a precaution against thieves; every house has a secret door and a shortcut to the communal house yard. Because the slope is well exploited and there are few side trades, the paths in Duong Lam are very clean and open.",
    "The most distinctive feature is the village layout: fishbone-shaped lanes with one main axis and many small alleys interconnecting, so villagers can reach home whichever way they go and a thief will be caught whichever way he runs (because when the alarm is raised the village men pour out and immediately meet at one point).",
    "Walking once along a quiet village road, with mossy laterite walls on both sides and closed house gates, the atmosphere here feels somewhat pensive and dreamlike, so that on returning one misses so much the ochre colour of the laterite walls glowing in the afternoon sun of the Doai region.",
    "Soy sauce making in Duong Lam dates back to ancient times and every house has a few jars of sauce sunning in the yard.",
    "In addition, Duong Lam has a system of lineage halls, shrines, rest houses, ancient wells and lanes, together with a lively landscape environment of 36 mounds, 18 deep hollows, 49 ponds, lakes and pools, and dozens of old trees including banyan, bodhi, ficus and false olive, most notably a row of 29 old false olive trees at the temple and tomb of Ngo Quyen. Legend has it that this is where kings Phung Hung and Ngo Quyen tethered their war elephants and horses. The undulating fields, mounds and hills are extremely lively and attract photographers when the harvest season comes, or when the rice and maize are at their greenest.",
    "Duong Lam is the first rural ancient village in the country to be ranked a national relic. The ancient village at Duong Lam is an event of significance not only in the cultural life of the Party organisation and people of Duong Lam and of the city of Hanoi. However, the Duong Lam ancient village relic complex is now deteriorating and greatly needs conservation and restoration."
  ]'::jsonb) WITH ORDINALITY AS a(en, j) ON a.j = t.i
  ),
  updated_at = now()
WHERE slug = 'di-tich-quoc-gia-lang-co-duong-lam';

-- [11] kien-truc-thu-vien-cong-dong-o-thu-do-amsterdam-ha-lan (41 doan)
UPDATE news_posts SET
  title   = title   || '{"en":"The architecture of the public library in Amsterdam, the Netherlands"}'::jsonb,
  summary = summary || '{"en":"An introduction to De Openbare Bibliotheek - the public library in Amsterdam, a place that both gathers books and offers a distinctive, well-considered architectural space. Design: Jo Coenen & Co, architect Jo Coenen; client: the Amsterdam city council; location: Oosterdokseiland 143, 1011 DL Amsterdam; area 28,500 sq.m; completed in 2007."}'::jsonb,
  content = (
    SELECT jsonb_agg(t.e || jsonb_build_object('en', a.en) ORDER BY t.i)
    FROM jsonb_array_elements(news_posts.content) WITH ORDINALITY AS t(e, i)
    JOIN jsonb_array_elements_text('[
    "A public library is indispensable in modern society, a place holding boundless knowledge for every social class. De Openbare Bibliotheek - the public library in Amsterdam - not only gathers books across space and time but also possesses a distinctive and well-considered architectural space.",
    "Design firm: Jo Coenen & Co architectural design",
    "Architect: Jo Coenen",
    "Client: the Amsterdam city council",
    "Location: Oosterdokseiland 143, 1011 DL Amsterdam, The Netherlands",
    "Area: 28,500 sq.m",
    "Year of completion: 2007",
    "Total cost: 80 million Euro",
    "Location of the building in the city of Amsterdam",
    "Architect Jo Coenen graduated from the Technische Hogeschool in Eindhoven and works in a Central and Southern European architectural manner, known for administrative and public buildings throughout the Netherlands.",
    "Together with the Vesteda building in Eindhoven and the Markt-Maas project in the centre of Maastricht, the Openbare Bibliotheek public library was among the first library projects by architect Jo Coenen, built at the same time in the early years of the twenty-first century.",
    "Floor plan of the building",
    "Section of the building",
    "With an area of 28,500 sq.m, the Openbare Bibliotheek is the largest library in Europe, with more than 7,000 visits a day. The idea of the building is to create a space not only for reading but also a community cultural centre with many different activities. The interaction between interior and exterior is expressed coherently and rationally.",
    "The building is carved because it sits next to the boundary of the city",
    "To create the most comfortable interior, the building takes the form of a carved rock, because it stands right at the city boundary line. Yet this is exactly what opened the way for the architects creativity.",
    "The entrance lobby area",
    "With its carved form, the interior is also easily divided into different zones. With one area gathering everyone together, the other spaces are arranged for the easiest access.",
    "The general reading area in the library",
    "However, as a library, a quiet and separate space plays an indispensable role. Designing such a space within a public space is a difficult problem for architects. Good sound-insulating materials such as cavity walls and toughened glass are used to solve it",
    "A dedicated area for those who need quiet",
    "What is easily noticed in this public library is the contrast, with zoning based on the nature of the activities. The base plinth is for the community activities of the city, the middle part is for the main function of the building - the library - and the top is for business and visitor meeting areas, including a restaurant and a cinema.",
    "The public area (base plinth)",
    "The library area",
    "The business and visitor meeting area",
    "A city view from the library",
    "Instead of using bricks, the building uses locally available stone for the enclosing structure, combined with a reinforced concrete load-bearing structure and timber finishes. Using stone for the walls not only makes use of local materials and avoids using clay for bricks - which is discouraged in developed countries - but also creates a very distinctive space and adds to the durability of the building.",
    "The enclosing structure is built of stone instead of fired brick",
    "For buildings of a large size such as the Openbare Bibliotheek, bringing natural light inside is no easy task.",
    "Architect Jo Coenen made use of every possible space to bring natural light into the building by creating curved corners at the edges to enlarge the light-gathering area, and by creating voids and designing the escalators as reflectors to bring light into the central area.",
    "Curved glass panels are used to optimise the capture of natural light",
    "Using voids to bring in light",
    "The escalators act as reflectors",
    "The artificial lighting system draws its image from windmills - an emblem of the Netherlands",
    "In designing the building, the architectural and structural solutions proposed had to be matched by construction technology. The structural solution chosen is a monolithic reinforced concrete frame with round columns at large spans (a structure commonly seen in public buildings), together with a suspended canopy on the outside of the building.",
    "The canopy system and timber cladding on the exterior of the building",
    "The air-conditioning system is neatly arranged within the voids, so no ductwork is needed within the floor system. The plumbing services are arranged as a second escape zone, so the floor system remains continuous and does not need to be divided.",
    "Services are arranged through the voids to avoid cutting up the floor slabs",
    "Most buildings in developed countries pay attention to saving energy. The Openbare Bibliotheek is no exception: besides using natural stone instead of brick and tile, the roof is equipped with a photovoltaic system, adding to the sustainability of the building.",
    "The photovoltaic system installed on the roof of the building",
    "A large public building with different and contrasting spaces demands a great deal of rigour and rationality in spatial arrangement. With their creativity in designing the public library in Amsterdam, the architects fulfilled their task very well in creating a product that meets the development needs of society."
  ]'::jsonb) WITH ORDINALITY AS a(en, j) ON a.j = t.i
  ),
  updated_at = now()
WHERE slug = 'kien-truc-thu-vien-cong-dong-o-thu-do-amsterdam-ha-lan';

-- [12] huong-dan-chon-vi-tri-bep-trong-phong-bep (17 doan)
UPDATE news_posts SET
  title   = title   || '{"en":"How to choose the position of the cooker in the kitchen"}'::jsonb,
  summary = summary || '{"en":"The kitchen plays the most important role in the house yet is often the least invested in. The kitchen is not only where meals are cooked but also carries great feng shui weight, and the position of the stove in particular determines fortune and family relationships. The article sets out the basic principles for choosing the position of the cooker, starting with the rule that the cook must have a commanding view."}'::jsonb,
  content = (
    SELECT jsonb_agg(t.e || jsonb_build_object('en', a.en) ORDER BY t.i)
    FROM jsonb_array_elements(news_posts.content) WITH ORDINALITY AS t(e, i)
    JOIN jsonb_array_elements_text('[
    "Of all the spaces in the house, the kitchen plays the most important role, yet it receives the least attention and investment. Remember, the kitchen is not only where meals are cooked for the family but also carries great feng shui weight. The position of the stove in particular is decisive for fortune as well as family relationships. Therefore, designing and building the kitchen in general, and choosing the position of the cooker in particular, should follow these basic principles.",
    "1. The cooking position must have a commanding view",
    "Cooking requires the cook to stand, but where they stand is what matters. Feng shui holds that the cooking position must be high and dry with a broad view opening onto the whole room. This helps the cook keep control of the view and avoid distraction when someone enters or moves about, and so avoid risks and accidents while cooking.",
    "However, most kitchens today face the wall, so the cook cannot see who or what is behind them. To remedy this, hang a large mirror on the wall so you can observe what is behind you. The larger the mirror, the better the effect.",
    "2. Avoid placing the cooker in a corner",
    "Corner positions in the house are all considered unfavourable. Just as the sofa should not sit in the corner of the living room and the bed should not be placed in the corner of the bedroom, so too in the kitchen the corner is absolutely not the place for the cooker. The reasons are:",
    "- A corner position makes it hard for the cook to move about and limits the view.",
    "- The movement of energy and good fortune is obstructed.",
    "If the cooker has unfortunately been placed there, it can be remedied by hanging a mirror or a wind chime near the doorway or above the cooking area. The sound of the wind chime activates energy and signals that someone has entered the kitchen.",
    "3. Do not place the cooker next to the sink or the refrigerator",
    "The sink and the refrigerator are regarded as the water element, while the cooker is the fire element. In feng shui, water and fire are strongly opposed, yet a kitchen cannot do without these three items: cooker, sink and refrigerator. Care is therefore needed in arranging them. The cooker, sink and refrigerator should sit diagonally to one another forming a triangle with sides of 2 m. If such an arrangement is not possible, remedy it by placing a green rug on the floor or a potted plant in between to prevent conflict.",
    "4. Do not place the cooker near a window",
    "In building design, positions near a window are often highly regarded because they are fresh, airy and breezy, especially when the view outside is beautiful with features such as a swimming pool or a waterfall, creating positive energy. In kitchen design, however, the cooker must never be placed next to a window, as this disperses the gathered energy; the breeze from outside can blow out the flame on the stove - the very flame of warmth and prosperity for the whole family.",
    "5. Do not place the microwave above the cooker",
    "The modern kitchen is full of modern appliances such as steamers, ovens and microwaves. Feng shui advises that however much you want to save space, you should not place the microwave above the cooker, as this can suppress the flow of surrounding energy. Put the microwave on a shelf, a rack or another suitable place in the kitchen.",
    "6. Expanding a narrow space",
    "For kitchens in apartment buildings, the biggest limitation is their small size, which the owner cannot expand or alter at will. In this case the only remedy is to add mirrors around the kitchen to create the illusion of a bright, airy and spacious room. The best places to hang mirrors are at the two ends of the kitchen so that energy is not obstructed in the cramped space."
  ]'::jsonb) WITH ORDINALITY AS a(en, j) ON a.j = t.i
  ),
  updated_at = now()
WHERE slug = 'huong-dan-chon-vi-tri-bep-trong-phong-bep';

-- [13] thiet-ke-san-vuon-hop-phong-thuy-mang-an-lanh-cho-gia-chu (24 doan)
UPDATE news_posts SET
  title   = title   || '{"en":"A feng shui garden design that brings peace to the owner"}'::jsonb,
  summary = summary || '{"en":"The prosperous energy of a house comes not only from arranging the interior according to feng shui; the exterior landscape also plays an extremely important role as the place that regulates and balances yin and yang energy for the living space."}'::jsonb,
  content = (
    SELECT jsonb_agg(t.e || jsonb_build_object('en', a.en) ORDER BY t.i)
    FROM jsonb_array_elements(news_posts.content) WITH ORDINALITY AS t(e, i)
    JOIN jsonb_array_elements_text('[
    "The prosperous energy of a house does not come simply from arranging the interior according to feng shui; the exterior landscape also plays an extremely important role as the place that regulates and balances the yin and yang energy of your living space.",
    "Today, how to arrange the garden in line with feng shui is of great interest to many people, because it is believed that this brings the family peace and smooth business. When designing a garden, owners should therefore pay attention to the following points to obtain a space that is both aesthetically beautiful and sound in feng shui terms.",
    "The best garden orientation is south",
    "The orientation of the garden is defined by the main direction from which the owner usually enters it. Each orientation attracts different energy. For a garden, the best direction according to Eastern feng shui is south. South is regarded as an auspicious direction bringing plenty of yang energy and good luck to the owner. If the garden in front of your house cannot face south for aesthetic reasons, place a statue or an image of a phoenix to attract this yang energy.",
    "If the garden cannot be laid out facing south, east is also an ideal choice, as it too attracts wholesome energy. With this sunrise orientation the owner should plant clumping species such as bamboo to attract good energy and help bond and support family relationships.",
    "The best garden orientation is south",
    "The garden gate must be in proportion to the size of the garden",
    "Feng shui holds that the garden gate should not be too wide, because a wide gate lets energy come and go too quickly without gathering. However, too narrow a gate is also unwise, as energy then becomes trapped and stagnant. The owner therefore needs to balance the size of the garden when choosing a suitable gate size.",
    "Feng shui experts also advise that the gate is best made with widely spaced bars so that energy circulates easily; a solid-panel gate should only be used when there is a harmful current of air outside that must be blocked (for example when the garden faces a foul-smelling drain). You should also avoid growing too many climbing plants over the gate, as they will obscure it.",
    "The gate must be in proportion to the size of the garden.",
    "The path and entrance to the garden should not run straight",
    "The garden space in front of the house is where wholesome energy gathers for your home. The owner therefore needs to arrange the details here in line with feng shui, especially the path leading into the house. The entrance path is also the main route for energy. It should attract energy and lead it in a harmonious, flowing way through the garden. Avoid an entrance that is too straight, as energy then enters the garden too strongly and is not balanced at every point.",
    "Good energy for a garden must circulate along winding, meandering lines. If your garden already has a straight path, remedy it by planting clumps of shrubs or flowers overlapping into the path to break the straight line.",
    "Do not choose materials with an uneven surface. On the contrary, choose firm and stable materials for easy movement. A brick path can be laid in various patterns such as straight, wavy or continuous.",
    "The path to the house should wind and meander.",
    "Decorative ceramic jars in the garden bring good luck",
    "In the garden the owner should place figures of long-living animals such as deer, tortoises or cranes to bring health and longevity to the family. Auspicious ornaments or statues can be placed around the garden to create good fortune.",
    "Place large ceramic jars with symbols of good luck to attract energy. For rock gardens, it is best to remove sharp stones and use only rounded, harmless ones. Avoid placing large rocks too close to the house, as this will not bring luck to family members.",
    "In particular, another garden design principle is mountain behind and water in front. In feng shui, water attracts energy and brings money into the house, so water is a symbol of wealth. A swimming pool or fish pond, a waterfall with rocks and plants, or a fountain is very suitable for the front garden.",
    "A small fish pond in front of the house will attract energy to your home.",
    "Plant plenty of greenery in different colours",
    "The feng shui of plants requires special attention. Plants and flowers not only add colour and fragrance to your garden but also balance the flow of energy. Each area of the garden or yard should therefore have plenty of colour created by your favourite plants and flowers. For example, white flowers can be interspersed as a focal point in a garden of a single green tone.",
    "Mountain behind and water in front",
    "Another garden design principle is mountain behind and water in front. According to feng shui, water attracts energy and brings money into your home, so water is a symbol of wealth. A swimming pool or fish pond, a fountain, or a waterfall with rocks and plants is very suitable for the front garden."
  ]'::jsonb) WITH ORDINALITY AS a(en, j) ON a.j = t.i
  ),
  updated_at = now()
WHERE slug = 'thiet-ke-san-vuon-hop-phong-thuy-mang-an-lanh-cho-gia-chu';

-- [14] pho-di-bo-sap-co-mat-tai-thanh-pho-ben-tre (25 doan)
UPDATE news_posts SET
  title   = title   || '{"en":"A walking street is coming to Ben Tre city"}'::jsonb,
  summary = summary || '{"en":"A new step for Ben Tre on its path of urbanisation, keeping pace with Vietnam key cities. Hung Long walking street - dubbed the second Nguyen Hue walking street and the only walking street in the western coastal region - is designed so that residents can take in a panoramic view of Ben Tre city. The street forms part of the master plan of the Hung Phu urban area project on Nguyen Thi Dinh street, Phu Tan ward, Ben Tre city."}'::jsonb,
  content = (
    SELECT jsonb_agg(t.e || jsonb_build_object('en', a.en) ORDER BY t.i)
    FROM jsonb_array_elements(news_posts.content) WITH ORDINALITY AS t(e, i)
    JOIN jsonb_array_elements_text('[
    "This is seen as a new step for Ben Tre on its path of urbanisation, keeping pace with the development and amenities of Vietnam key cities, most notably Ho Chi Minh City.",
    "Hung Long walking street, with its distinctive strolling space and dubbed the second Nguyen Hue walking street, is coming to Ben Tre city. It is also the only walking street in the western coastal region, designed so that residents can take in a panoramic view of the beauty of Ben Tre city.",
    "The walking street forms part of the master plan of the Hung Phu urban area project on Nguyen Thi Dinh street, Phu Tan ward, Ben Tre city. The planning of Hung Long walking street is a major effort by Thien Duc Investment Construction Trading Co., Ltd together with the authorities of Ben Tre province, with the wish to bring the area quickly into step with the development and amenities of Vietnam key cities. Thanks to the link provided by the Rach Mieu bridge, Ben Tre is now just over an hour drive from Ho Chi Minh City.",
    "A lively Saigon in the heart of Ben Tre",
    "The Hung Phu urban area covers more than 112,521 sq.m with an investment of about 900 billion dong over a five-year schedule (2015 - 2020), planned for commercial use with a variety of housing types serving the diverse residential, resort or business needs of owners.",
    "The An Thinh garden townhouse model, laid out on plots of 5 m x 20 m or 6 m x 20 m, brings owners a green living space to a scaled-down standard of luxury villas.",
    "An Thinh garden townhouse.",
    "Townhouse interior.",
    "Bringing owners a green living space to a scaled-down standard of luxury villas.",
    "For owners who wish to live and do business at the same time, the Hung Long commercial townhouse is the ideal choice. Each unit in the commercial townhouse has a ground floor and three upper floors with a total usable area of 100 sq.m to 200 sq.m, the ground floor designed as a shopfront. Owners can therefore expand their existing business or lease the premises to exploit the value of the asset invested and add to their income.",
    "Owners can expand their existing business or lease the premises to exploit the value of the asset invested and add to their income.",
    "In the Hung Phu urban area, the green living space is created in harmony with nature and feng shui and, above all, bears the personal mark of the owner. In the upmarket living space of the Phu Gia villas, owners and their family, friends or partners can hold elegant European-style outdoor gatherings or lively pool parties. With dedicated, upmarket services and security, concierge and doctor on duty 24/7, the setting is private and absolutely safe for you and your family.",
    "The green living space is created in harmony with nature and feng shui and, above all, bears the personal mark of the owner.",
    "Outstanding amenities",
    "Besides the tangible high-end amenities such as standard tennis courts, a swimming pool, an upmarket gym, an international kindergarten and a bustling shopping centre and supermarket system with parking of up to 3,000 square metres, what will make the Hung Phu urban area the most liveable place is the planning of more than 7,000 square metres of tree-shaded grounds in harmony with modern, upmarket amenities. This is the highlight that expresses the deep humanity running through every investment project of Thien Duc.",
    "More than 7,000 square metres of tree-shaded grounds in harmony with modern, upmarket amenities.",
    "Parking of up to 3,000 square metres.",
    "Standard tennis courts, a swimming pool and an upmarket gym.",
    "A position at the administrative heart",
    "One crucial reason the Hung Phu urban area is called the administrative heart is the planning of the inter-departmental building - the only inter-departmental administrative centre in the western coastal region - located right within the project grounds.",
    "With its distinctive, modern architecture, the inter-departmental building carries a profound meaning about the ceaseless future development that the provincial authorities will build for the area in particular and the western coastal region in general.",
    "On 20 September, the project was officially started with the attendance of leaders of the province, its departments and agencies, and leaders of the People Committee of Ben Tre city.",
    "Zoom in",
    "Share",
    "Groundbreaking ceremony of the Hung Phu urban area project."
  ]'::jsonb) WITH ORDINALITY AS a(en, j) ON a.j = t.i
  ),
  updated_at = now()
WHERE slug = 'pho-di-bo-sap-co-mat-tai-thanh-pho-ben-tre';

-- [15] pho-di-bo-nguyen-hue-sap-co-mat-tai-thanh-pho-ben-tre (16 doan)
UPDATE news_posts SET
  title   = title   || '{"en":"A Nguyen Hue style walking street is coming to Ben Tre city"}'::jsonb,
  summary = summary || '{"en":"Hung Long walking street, with its distinctive strolling space and dubbed the second Nguyen Hue walking street, is the only walking street in the western coastal region, designed as a public meeting space with a soul. It forms part of the master plan of the Hung Phu urban area project on Nguyen Thi Dinh street, Phu Tan ward, Ben Tre city - a breakthrough by Thien Duc Investment Construction Trading Co., Ltd together with the authorities of Ben Tre province."}'::jsonb,
  content = (
    SELECT jsonb_agg(t.e || jsonb_build_object('en', a.en) ORDER BY t.i)
    FROM jsonb_array_elements(news_posts.content) WITH ORDINALITY AS t(e, i)
    JOIN jsonb_array_elements_text('[
    "Hung Long walking street, with its distinctive strolling space and dubbed the second Nguyen Hue walking street, is the only walking street in the western coastal region. It is designed as a public meeting space with a soul, where the community can stroll together and take in a panoramic view of the beauty of Ben Tre city.",
    "Hung Long walking street forms part of the master plan of the Hung Phu urban area project on Nguyen Thi Dinh street, Phu Tan ward, Ben Tre city. The planning of Hung Long walking street is a breakthrough through which Thien Duc Investment - Construction - Trading Co., Ltd, together with the authorities of Ben Tre province, wishes to bring Ben Tre city quickly into step with the development and outstanding amenities of Vietnam key cities. Thanks to the link provided by the Rach Mieu bridge, Ben Tre is now just over an hour drive from Ho Chi Minh City.",
    "A lively Saigon in the heart of Ben Tre city",
    "The Hung Phu urban area covers more than 112,521 sq.m with an investment of about 900 billion dong over a five-year schedule (2015 - 2020), planned for commercial use with a variety of housing types serving the diverse residential, resort or business needs of owners.",
    "The An Thinh garden townhouse model, laid out on plots of 5 m x 20 m or 6 m x 20 m, brings owners a green living space to a scaled-down standard of luxury villas.",
    "For owners who wish to live and do business at the same time, the Hung Long commercial townhouse is the ideal choice. Each unit in the commercial townhouse has a ground floor and three upper floors with a total usable area of 100 to 200 sq.m, the ground floor designed as a shopfront. Owners can therefore expand their existing business or lease the premises to exploit the value of the asset invested and add to their income.",
    "The green living space is created in harmony with nature and feng shui and, above all, bears the personal mark of the owner. In the upmarket living space of the Phu Gia villas, owners and their family, friends or partners can hold elegant European-style outdoor gatherings or lively pool parties. With dedicated, upmarket services and security, concierge and doctor on duty 24/7, the setting is private and absolutely safe for you and your family.",
    "Outstanding amenities",
    "Besides the tangible high-end amenities such as standard tennis courts, a swimming pool and an upmarket gym, an international kindergarten and a bustling shopping centre and supermarket system with parking of up to 3,000 sq.m, what will make the Hung Phu urban area the most liveable place is the planning of more than 7,000 sq.m of tree-shaded grounds in harmony with modern, upmarket amenities. This is the highlight that expresses the deep humanity running through every investment project of Thien Duc: All the projects we invest in bring every family an ever better quality of life.",
    "More than 7,000 sq.m of tree-shaded grounds in harmony with modern, upmarket amenities",
    "Standard tennis courts, a swimming pool and an upmarket gym",
    "A position at the administrative heart",
    "One crucial reason the Hung Phu urban area is called the administrative heart is the planning of the inter-departmental building - the only inter-departmental administrative centre in the western coastal region - located right within the project grounds.",
    "With its distinctive, modern architecture, the inter-departmental building carries a profound meaning about the ceaseless future development that the provincial authorities will build for the area in particular and the western coastal region in general.",
    "On 20 September, the project was officially started with the attendance of Mr. Vo Thanh Hao - Secretary of the Provincial Party Committee, Mr. Cao Van Trong - Chairman of the People Committee of Ben Tre province, Mr. Truong Duy Hai - Vice Chairman of the provincial People Committee, along with leaders of provincial departments and agencies and leaders of the People Committee of Ben Tre city.",
    "Groundbreaking ceremony of the Hung Phu urban area project"
  ]'::jsonb) WITH ORDINALITY AS a(en, j) ON a.j = t.i
  ),
  updated_at = now()
WHERE slug = 'pho-di-bo-nguyen-hue-sap-co-mat-tai-thanh-pho-ben-tre';

-- [16] tphcm-bat-dong-san-cao-cap-tang-gia-manh (16 doan)
UPDATE news_posts SET
  title   = title   || '{"en":"Ho Chi Minh City: high-end property prices rise sharply"}'::jsonb,
  summary = summary || '{"en":"Besides an excessive supply of high-end apartments in Ho Chi Minh City, selling prices have also begun to rise sharply. Many experts warn that if developers keep pushing prices up, the market will freeze immediately. Primary prices have risen 7-10% and secondary prices 10-20%."}'::jsonb,
  content = (
    SELECT jsonb_agg(t.e || jsonb_build_object('en', a.en) ORDER BY t.i)
    FROM jsonb_array_elements(news_posts.content) WITH ORDINALITY AS t(e, i)
    JOIN jsonb_array_elements_text('[
    "Besides an excessive supply of high-end apartments in Ho Chi Minh City, selling prices have also begun to rise sharply. Experts have immediately warned that if developers keep adjusting prices upwards, the market will freeze at once.",
    "Summary",
    "At present, primary prices at projects sold in phases with good construction progress have risen a further 7-10%. Secondary prices have risen 10-20%. Only a few projects far from the centre have seen prices fall, and the decrease is insignificant.",
    "According to our survey through property brokers, because the apartments at these projects were sold out earlier, buyers who now want one must buy from the previous owner. Such hand-over prices are marked up by at least 2 million dong per sq.m and at most 5-7 million dong per sq.m.",
    "Dr. Nguyen Tri Hieu affirms that housing prices, having risen by as much as 20%, will create many risks for the market, the greatest being the emergence of a property bubble.",
    "According to the Ho Chi Minh City property market report by JLL Vietnam, in the third quarter of 2015 the city had more than 6,800 new apartments launched, with the high-end segment accounting for 35% of the market (a 10% increase on total supply in the first half of the year). At present, primary prices at projects sold in phases with good construction progress have risen a further 7-10%. Secondary prices have risen 10-20%. Only a few projects far from the centre have seen prices fall, and the decrease is insignificant.",
    "For example, Khang Dien real estate recently launched the Lucasta high-end villa project in District 9 to get ahead of the recovering market. The project is priced quite high at 7.8 billion dong for a semi-detached villa. The most expensive detached villas here reach 25.5 billion dong. Previously this project was offered at 6.6 billion dong for a semi-detached villa.",
    "At the same time, several other high-end projects are raising prices for their next sales phase. For instance, The Sun Avenue was offered at only 32.8 million dong per sq.m in the second quarter but jumped to 35.4 million dong per sq.m in the third; Sarimi by Dai Quang Minh is being sold at a peak price of 50.5 million dong per sq.m, 2 million dong per sq.m higher than the previous quarter; Vinhomes Central Park sold at 42.1 million dong per sq.m last quarter but is now selling at 45.4 million dong per sq.m.",
    "According to our survey through property brokers, because a series of apartments at the above projects were sold out earlier, buyers who now want one must buy from the previous owner. Such hand-over prices are marked up by at least 2 million dong per sq.m and at most 5-7 million dong per sq.m.",
    "Speaking to us at the recent launch of The Nassim, Mr. Nguyen Hoang Tuan, Chairman of Son Kim Investment Holdings, said that The Gateway Thao Dien has sold 70% and has paused the remaining 30% in order to adjust prices when the metro station nears completion. The phase 1 asking price of this project is currently 1,800 USD per sq.m.",
    "Speaking to us on the morning of 21 October, Mr. Nguyen Vinh Tran, General Director of Jen Capital, said the property market at this point is not what it was before 2006. That is, back then apartment supply was scarce and buyers settled on a final price with little regard for comparable prices at surrounding projects. Today, within the same area there are many projects of the same type with many advantages in amenities and price, so buyers are able to compare before buying.",
    "If any developer keeps using the trick of holding back stock to create scarcity and then raising prices, it is killing itself. For the same house, buyers may accept being a little further from the metro station as long as the living space and product quality are assured at a reasonable price, Mr. Tran said.",
    "According to Mr. Nguyen Van Duc, Deputy General Director of Dat Lanh real estate, the high-end apartment market is close to inflation because supply has risen too sharply at the same time. Many developers announcing that a project sold 100% or 70-80% right after one launch is highly doubtful, since that does not account for apartments handed over to distribution units.",
    "In addition, some small brokers also take 2-5 units to resell for profit and these are counted as successful transactions. This may also be a trick to create scarce supply and drive prices up for buyers, Mr. Duc affirmed.",
    "Some property experts are beginning to worry about latent instability because of artificial price rises in certain areas and projects. Dr. Nguyen Tri Hieu affirms that housing prices, having risen by as much as 20%, will create many risks for the market, the greatest being the emergence of a property bubble.",
    "At present there are also many trading floors and brokers playing tricks to inflate prices. Alongside this, some newly launched projects are priced far too high relative to the actual income levels of the population. Explaining this, Dr. Le Ba Chi Nhan says developers often use a few soon-to-be-completed transport infrastructure projects as grounds for raising prices. However, infrastructure is not the only factor deciding whether buyers put their money down; much also depends on quality, the reputation of the developer and the living environment of the project."
  ]'::jsonb) WITH ORDINALITY AS a(en, j) ON a.j = t.i
  ),
  updated_at = now()
WHERE slug = 'tphcm-bat-dong-san-cao-cap-tang-gia-manh';

-- [17] se-tran-ngap-cac-thuong-vu-m-a-bat-dong-san-trong-nam-2016 (22 doan)
UPDATE news_posts SET
  title   = title   || '{"en":"A wave of real estate M&A deals expected in 2016"}'::jsonb,
  summary = summary || '{"en":"According to JLL, Vietnam has seen remarkable growth in M&A activity over the past 12 months and the upward trend is continuing."}'::jsonb,
  content = (
    SELECT jsonb_agg(t.e || jsonb_build_object('en', a.en) ORDER BY t.i)
    FROM jsonb_array_elements(news_posts.content) WITH ORDINALITY AS t(e, i)
    JOIN jsonb_array_elements_text('[
    "According to JLL, Vietnam has seen remarkable growth in M&A activity over the past 12 months and the upward trend is continuing.",
    "Cushman & Wakefield announces the biggest M&A deal in global real estate",
    "Dead projects - a tempting prize in the M&A battle in Ho Chi Minh City",
    "Ho Chi Minh City property: projects dead for years, the M&A market booms",
    "Summary",
    "In its analysis, JLL says that by comparison Vietnam is becoming a more attractive destination for foreign investment capital in the medium term than many other countries in Southeast Asia.",
    "The Vietnamese property market recorded a total transaction value from M&A activity of 535 million USD.",
    "Another step forward for the investment market can be found in the amended Investment Law 2014, namely the improvement of the investment licensing process, especially licensing for foreign investors.",
    "Foreign investment funds land in Vietnam",
    "This growth is thanks to a developing economy and a property market that has bottomed out in its development cycle. Data from the General Statistics Office shows that Vietnam GDP growth is accelerating, reaching 6.81% in the third quarter of 2015, up from 6.47% in the second quarter and 6.12% in the first.",
    "In addition, the Asian Development Bank (ADB) raised its GDP growth forecast for Vietnam for the whole of 2015 to 6.5%, the highest among six Southeast Asian countries including Thailand, Indonesia, Vietnam, Malaysia, Singapore and the Philippines. The number of investors interested in Southeast Asia is considerable, and Vietnam is attracting much attention and is in the sights of both domestic and foreign investors.",
    "In its analysis, JLL says that by comparison Vietnam is becoming a more attractive destination for foreign investment capital in the medium term than many other countries in Southeast Asia. Data from Real Capital Analytics (RCA) also records greater interest from a number of foreign private equity funds allocating capital to Vietnam in an effort to increase their presence in the market.",
    "For example, in the second quarter of 2015 a subsidiary joint venture of Warburg Pincus, the US investment fund, invested a further 100 million USD in Vincom Retail, the largest shopping centre owner and operator in Vietnam. Also in that quarter, Gaw Capital Partners, together with domestic partner NP Capital, acquired four property projects across various segments from Indochina Land with a total value of 106 million USD. Gamuda Land also acquired a 40% stake (equivalent to 64.1 million USD) in Celadon City, a modern urban area initially invested in by a joint venture between Sacomreal, Thanh Thanh Cong and An Phu Gia.",
    "One notable deal is the Amata group purchase of a project for 279 million USD in Long Thanh district (Dong Nai), where an urban and industrial area with a total investment of 500 million USD is planned.",
    "Information from RCA records that Vietnam currently has 763 million USD in the property sector alone over this period. The Vietnamese property market recorded a total transaction value from M&A activity of 535 million USD.",
    "Driven by policy factors",
    "Alongside the improvement of the property market, the state has made positive changes to policies and legal regulations related to the investment market. Under the amended Investment Law 2014, the investment licensing process, especially licensing for foreign investors, has become more open.",
    "However, according to a recent JLL report on M&A activity, most foreign investors continue to look for commercial properties with good revenue. Yet investment opportunities remain limited in acquiring property projects. Many groups are therefore considering other segments and are ready to partner with reputable domestic players to gain a foothold in the market.",
    "Among them, Vietnam is a favoured choice of Singaporean investors. In addition, a large number of investors from Japan, South Korea, Hong Kong, the Philippines and Indonesia are actively seeking to own a slice of the Vietnamese property pie.",
    "The Mapletree group entered the Vietnamese property market in 2005 in the logistics sector. In 2012 the group completed the Mapletree Business City industrial project in Binh Duong. Its most recent project in Vietnam is its first shopping centre (SC Vivocity) in District 7, Ho Chi Minh City, a joint venture with Saigon Co-op Investment Development Corporation (SCID).",
    "In addition, in the third quarter of 2015 CapitaLand prepared to build its seventh residential investment project in Vietnam, in the belief that economic growth and urbanisation in Vietnam will drive domestic property demand. Ascott, the serviced apartment brand of CapitaLand, also entered Vietnam with a management contract for the Citadines Central project in Binh Duong in the third quarter of 2015.",
    "At the same time, Keppel Land has stepped up its investment as the market shows signs of recovery, developing phase 2 of Saigon Centre and phases 2 and 3 of Estella. Standard Chartered Private Equity is interested in investing in the affordable housing segment and is open to joint investment. Its joint ventures in Asia include a high-end housing development worth 160 billion IDR (Indonesian rupiah) and an affordable housing project worth 12.5 billion IDR in India."
  ]'::jsonb) WITH ORDINALITY AS a(en, j) ON a.j = t.i
  ),
  updated_at = now()
WHERE slug = 'se-tran-ngap-cac-thuong-vu-m-a-bat-dong-san-trong-nam-2016';

-- [18] le-khoi-cong-khu-do-thi-hung-phu-ben-tre-ngay-20-9 (8 doan)
UPDATE news_posts SET
  title   = title   || '{"en":"Groundbreaking ceremony of the Hung Phu urban area - Ben Tre on 20 September"}'::jsonb,
  summary = summary || '{"en":"On 20 September 2015, the Hung Phu urban area project in Ben Tre city was officially started. The ceremony was attended by Mr. Vo Thanh Hao - Secretary of the Provincial Party Committee, Mr. Cao Van Trong - Chairman of the People Committee of Ben Tre province, Mr. Truong Duy Hai - Standing Vice Chairman of the provincial People Committee, together with press agencies and representatives of departments and agencies. This is a strategically important project contributing to raising the urban standing of central Ben Tre city."}'::jsonb,
  content = (
    SELECT jsonb_agg(t.e || jsonb_build_object('en', a.en) ORDER BY t.i)
    FROM jsonb_array_elements(news_posts.content) WITH ORDINALITY AS t(e, i)
    JOIN jsonb_array_elements_text('[
    "On 20 September 2015, the Hung Phu urban area project in Ben Tre city was officially started. The groundbreaking ceremony was attended by Mr. Vo Thanh Hao - Secretary of the Provincial Party Committee, Mr. Cao Van Trong - Chairman of the People Committee of Ben Tre province, Mr. Truong Duy Hai - Standing Vice Chairman of the provincial People Committee, together with press agencies and representatives of departments and agencies.",
    "The Hung Phu urban area project is a strategically important project bearing the mark of the ceaseless effort and dedication of the leadership of Ben Tre city, which has been steering the province towards sustainable development. Planning and raising the urban standing of central Ben Tre city with the Hung Phu urban area project, right in the heart of the Ben Cho area at the crossroads of two key routes, Nguyen Thi Dinh and Dong Khoi, is a remarkable step forward, bringing the people of Ben Tre a new lifestyle experience at a new level, full of amenities and of the most modern scale.",
    "For further information, please contact:",
    "Thien Duc Investment Construction Trading Co., Ltd",
    "Address: 10 Tran Nao, Quarter 5, An Phu Ward, District 2, Ho Chi Minh City",
    "Telephone: 0837 407 188",
    "Fax: 0837 407 199",
    "Email: dautuxaydungthienduc@yahoo.com"
  ]'::jsonb) WITH ORDINALITY AS a(en, j) ON a.j = t.i
  ),
  updated_at = now()
WHERE slug = 'le-khoi-cong-khu-do-thi-hung-phu-ben-tre-ngay-20-9';

-- 3) Kiem tra sau khi chay: cau nay phai tra ve 0 dong -----------------------
-- (chay rieng sau COMMIT neu client khong hien ket qua trong transaction)
--
-- SELECT slug,
--        (title->>'en'   IS NULL) AS thieu_title_en,
--        (summary->>'en' IS NULL) AS thieu_summary_en,
--        (SELECT count(*) FROM jsonb_array_elements(content) e WHERE e->>'en' IS NULL) AS so_doan_thieu_en
--   FROM news_posts
--  WHERE image LIKE 'https://thienduccons.vn/img_data/%'
--    AND (title->>'en' IS NULL OR summary->>'en' IS NULL
--         OR EXISTS (SELECT 1 FROM jsonb_array_elements(content) e WHERE e->>'en' IS NULL));

COMMIT;
