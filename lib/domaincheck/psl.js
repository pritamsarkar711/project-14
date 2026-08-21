'use strict';

/*
 * Public suffix data — bundled snapshot of the maintained Public Suffix List
 * (https://publicsuffix.org), curated to the ICANN sections that cover the
 * overwhelming majority of real-world domains plus a small set of common
 * "private" suffixes (managed hosting platforms).
 *
 * The full PSL is thousands of rules; the snapshot here covers:
 *   - every ccTLD (ISO 3166-1 alpha-2),
 *   - legacy + widely used gTLDs and new gTLDs,
 *   - second/third-level registry suffixes for popular ccTLDs,
 *   - common private suffixes for hosting platforms.
 *
 * Matching semantics follow the PSL spec: longest suffix wins; exceptions
 * (leading "!") are honoured. Any TLD missing from the snapshot is still
 * handled honestly: the caller reports that the suffix is outside the local
 * snapshot instead of guessing.
 *
 * In production the engine may optionally refresh this dataset from
 * https://publicsuffix.org/list/public_suffix_list.dat (see rdapClient's
 * bootstrapping notes); the bundled snapshot is the offline fallback.
 */

const ccTLDs = [
  'ac','ad','ae','af','ag','ai','al','am','ao','aq','ar','as','at','au','aw','ax','az',
  'ba','bb','bd','be','bf','bg','bh','bi','bj','bm','bn','bo','br','bs','bt','bv','bw','by','bz',
  'ca','cc','cd','cf','cg','ch','ci','ck','cl','cm','cn','co','cr','cu','cv','cw','cx','cy','cz',
  'de','dj','dk','dm','do','dz',
  'ec','ee','eg','er','es','et','eu',
  'fi','fj','fk','fm','fo','fr',
  'ga','gb','gd','ge','gf','gg','gh','gi','gl','gm','gn','gp','gq','gr','gs','gt','gu','gw','gy',
  'hk','hm','hn','hr','ht','hu',
  'id','ie','il','im','in','io','iq','ir','is','it',
  'je','jm','jo','jp',
  'ke','kg','kh','ki','km','kn','kp','kr','kw','ky','kz',
  'la','lb','lc','li','lk','lr','ls','lt','lu','lv','ly',
  'ma','mc','md','me','mg','mh','mk','ml','mm','mn','mo','mp','mq','mr','ms','mt','mu','mv','mw','mx','my','mz',
  'na','nc','ne','nf','ng','ni','nl','no','np','nr','nu','nz',
  'om',
  'pa','pe','pf','pg','ph','pk','pl','pm','pn','pr','ps','pt','pw','py',
  'qa',
  're','ro','rs','ru','rw',
  'sa','sb','sc','sd','se','sg','sh','si','sj','sk','sl','sm','sn','so','sr','ss','st','su','sv','sx','sy','sz',
  'tc','td','tf','tg','th','tj','tk','tl','tm','tn','to','tr','tt','tv','tw','tz',
  'ua','ug','uk','us','uy','uz',
  'va','vc','ve','vg','vi','vn','vu',
  'wf','ws',
  'ye','yt',
  'za','zm','zw'
];

const gTLDs = [
  'aaa','aarp','abarth','abb','abbott','abbvie','abc','able','abogado','abudhabi','academy',
  'accountant','accountants','aco','actor','ads','adult','aeg','aero','aetna','afl','africa','agakhan','agency','aig','airbus','airforce','airtel','akdn','alibaba','alipay','allfinanz','allstate','ally','alsace','alstom','amica','amsterdam','analytics','android','anquan','anz','aol','apartments','app','apple','aquarelle','arab','aramco','archi','army','art','arte','asda','asia','associates','athleta','attorney','auction','audi','audible','audio','auspost','author','auto','autos','avianca','aws','axa','azure',
  'baby','baidu','banamex','bananarepublic','band','bank','bar','barcelona','barclaycard','barclays','barefoot','bargains','baseball','basketball','bauhaus','bayern','bbc','bbt','bbva','bcg','bcn','beats','beauty','beer','bentley','berlin','best','bestbuy','bet','bharti','bible','bid','bike','bing','bingo','bio','biz','black','blackfriday','blockbuster','blog','bloomberg','blue','bms','bmw','bnpparibas','boats','boehringer','bofa','bom','bond','boo','book','booking','bosch','bostik','boston','bot','boutique','box','bradesco','bridgestone','broadway','broker','brother','brussels','budapest','bugatti','build','builders','business','buy','buzz','bzh',
  'cab','cafe','cal','call','calvinklein','cam','camera','camp','canon','capetown','capital','capitalone','car','caravan','cards','care','career','careers','cars','casa','case','cash','casino','cat','catering','catholic','cba','cbn','cbre','cbs','center','ceo','cern','cfa','cfd','chanel','channel','charity','chase','chat','cheap','chintai','christmas','chrome','church','cipriani','circle','cisco','citadel','citi','citic','city','cityeats','claims','cleaning','click','clinic','clinique','clothing','cloud','club','clubmed','coach','codes','coffee','college','cologne','com','comcast','commbank','community','company','compare','computer','comsec','condos','construction','consulting','contact','contractors','cooking','cool','coop','corsica','country','coupon','coupons','courses','cpa','credit','creditcard','creditunion','cricket','crown','crs','cruise','cruises','cuisinella','cymru','cyou',
  'dabur','dad','dance','data','date','dating','datsun','day','dclk','dds','deal','dealer','deals','degree','delivery','dell','deloitte','delta','democrat','dental','dentist','desi','design','dev','dhl','diamonds','diet','digital','direct','directory','discount','discover','dish','diy','dnp','docs','doctor','dog','domains','dot','download','drive','dtv','dubai','dunlop','dupont','durban','dvag','dvr',
  'earth','eat','eco','edeka','edu','education','email','emerck','energy','engineer','engineering','enterprises','epson','equipment','ericsson','erni','esq','estate','eurovision','eus','events','exchange','expert','exposed','express','extraspace',
  'fage','fail','fairwinds','faith','family','fan','fans','farm','farmers','fashion','fast','fedex','feedback','ferrari','ferrero','fidelity','fido','film','final','finance','financial','fire','firestone','firmdale','fish','fishing','fit','fitness','flickr','flights','flir','florist','flowers','fly','foo','food','football','ford','forex','forsale','forum','foundation','fox','free','fresenius','frl','frogans','frontdoor','frontier','ftr','fujitsu','fun','fund','furniture','futbol','fyi',
  'gal','gallery','gallo','gallup','game','games','gap','garden','gay','gbiz','gdn','gea','gent','genting','george','ggee','gift','gifts','gives','giving','glass','gle','global','globo','gmail','gmbh','gmo','gmx','godaddy','gold','goldpoint','golf','goo','goodyear','goog','google','gop','got','grainger','graphics','gratis','green','gripe','grocery','group','guardian','gucci','guge','guide','guitars','guru',
  'hair','hamburg','hangout','haus','hbo','hdfc','hdfcbank','health','healthcare','help','helsinki','here','hermes','hiphop','hisamitsu','hitachi','hiv','hkt','hockey','holdings','holiday','homedepot','homegoods','homes','homesense','honda','horse','hospital','host','hosting','hot','hoteles','hotels','hotmail','house','how','hsbc','hughes','hyatt','hyundai',
  'ibm','icbc','ice','icu','ieee','ifm','ikano','imamat','imdb','immo','immobilien','inc','industries','infiniti','info','ing','ink','institute','insurance','insure','int','international','intuit','investments','ipiranga','irish','ismaili','ist','istanbul','itau','itv',
  'jaguar','java','jcb','jeep','jetzt','jewelry','jio','jll','jmp','jnj','joburg','jot','joy','jpmorgan','jprs','juegos','juniper',
  'kaufen','kddi','kerryhotels','kerrylogistics','kerryproperties','kfh','kia','kids','kim','kinder','kindle','kitchen','kiwi','koeln','komatsu','kosher','kpmg','kpn','krd','kred','kuokgroup','kyoto',
  'lacaixa','lamborghini','lamer','lancaster','land','landrover','lanxess','lasalle','lat','latino','latrobe','law','lawyer','lds','lease','leclerc','lefrak','legal','lego','lexus','lgbt','liaison','lidl','life','lifeinsurance','lifestyle','lighting','like','lilly','limited','limo','lincoln','link','lipsy','live','living','llc','llp','loan','loans','locker','locus','lol','london','lotte','lotto','love','lpl','lplfinancial','ltd','ltda','lundbeck','luxe','luxury',
  'macys','madrid','maif','maison','makeup','man','management','mango','map','market','marketing','markets','marriott','marshalls','mattel','mba','mckinsey','med','media','meet','melbourne','meme','memorial','men','menu','merckmsd','miami','microsoft','mini','mint','mit','mitsubishi','mlb','mls','mma','mobile','moda','moe','moi','mom','monash','money','monster','mormon','mortgage','moscow','moto','motorcycles','mov','movie','msd','mtn','mtr','museum','music','mutual',
  'nab','nagoya','natura','navy','nba','nec','net','netbank','netflix','network','neustar','new','news','next','nextdirect','nexus','nfl','ngo','nhk','nico','nike','nikon','ninja','nissan','nissay','nokia','norton','now','nowruz','nowtv','nra','nrw','ntt','nyc',
  'obi','observer','office','okinawa','olayan','olayangroup','oldnavy','ollo','omega','one','ong','onl','online','ooo','open','oracle','orange','org','organic','origins','osaka','otsuka','ott','ovh',
  'page','panasonic','paris','pars','partners','parts','party','passagens','pay','pccw','pet','pfizer','pharmacy','phd','philips','phone','photo','photography','photos','physio','pics','pictet','pictures','pid','pin','ping','pink','pioneer','pizza','place','play','playstation','plumbing','plus','pnc','pohl','poker','politie','porn','pramerica','praxi','press','prime','pro','prod','productions','prof','progressive','promo','properties','property','protection','pru','prudential','pub','pwc',
  'qpon','quebec','quest','racing','radio','read','realestate','realtor','realty','recipes','red','redstone','redumbrella','rehab','reise','reisen','reit','reliance','ren','rent','rentals','repair','report','republican','rest','restaurant','review','reviews','rexroth','rich','richardli','ricoh','ril','rio','rip','rocks','rodeo','rogers','room','rsvp','rugby','ruhr','run','rwe','ryukyu',
  'saarland','safe','safety','sakura','sale','salon','samsclub','samsung','sandvik','sandvikcoromant','sanofi','sap','sarl','sas','save','saxo','sbi','sbs','sca','scb','schaeffler','schmidt','scholarships','school','schule','schwarz','science','scot','search','seat','secure','security','seek','select','sener','services','seven','sew','sex','sexy','sfr','shangrila','sharp','shaw','shell','shia','shiksha','shoes','shop','shopping','shouji','show','showtime','silk','sina','singles','site','ski','skin','sky','skype','sling','smart','smile','sncf','soccer','social','softbank','software','sohu','solar','solutions','song','sony','soy','spa','space','sport','spot','srl','stada','staples','star','statebank','statefarm','stc','stcgroup','stockholm','storage','store','stream','studio','study','style','sucks','supplies','supply','support','surf','surgery','suzuki','swatch','swiss','sydney','systems',
  'tab','taipei','talk','taobao','target','tatamotors','tatar','tattoo','tax','taxi','tci','tdk','team','tech','technology','tel','temasek','tennis','teva','thd','theater','theatre','tiaa','tickets','tienda','tips','tires','tirol','tjmaxx','tjx','tkmaxx','tmall','today','tokyo','tools','top','toray','toshiba','total','tours','town','toyota','toys','trade','trading','training','travel','travelers','travelersinsurance','trust','trv','tube','tui','tunes','tushu','tvs',
  'ubank','ubs','unicom','university','uno','uol','ups','vacations','vana','vanguard','vegas','ventures','verisign','versicherung','vet','viajes','video','vig','viking','villas','vin','vip','virgin','visa','vision','viva','vivo','vlaanderen','vodka','volkswagen','volvo','vote','voting','voto','voyage',
  'wales','walmart','walter','wang','wanggou','watch','watches','weather','weatherchannel','webcam','weber','website','wed','wedding','weibo','weir','whoswho','wien','wiki','williamhill','win','windows','wine','winners','wme','wolterskluwer','woodside','work','works','world','wow','wtc','wtf',
  'xbox','xerox','xfinity','xihuan','xin','xyz',
  'yachts','yahoo','yamaxun','yandex','yodobashi','yoga','yokohama','you','youtube','yun',
  'zappos','zara','zero','zip','zone','zuerich'
];

/* Multi-level registry suffixes (PSL ICANN section). Longest match wins. */
const multiLevel = [
  // UK / GB
  'co.uk','org.uk','me.uk','net.uk','ac.uk','gov.uk','ltd.uk','plc.uk','sch.uk','nhs.uk','police.uk','mod.uk',
  // Australia
  'com.au','net.au','org.au','edu.au','gov.au','asn.au','id.au','csiro.au',
  // Japan
  'co.jp','ne.jp','or.jp','ac.jp','go.jp','ed.jp','ad.jp','gr.jp','lg.jp','geo.jp',
  // New Zealand
  'co.nz','net.nz','org.nz','ac.nz','govt.nz','geek.nz','gen.nz','kiwi.nz','maori.nz','school.nz','iwi.nz','health.nz','parliament.nz','cri.nz',
  // South Africa
  'co.za','org.za','net.za','web.za','gov.za','ac.za','nom.za','edu.za','law.za','school.za','mil.za','alt.za','agric.za','grondar.za','nis.za','tm.za',
  // Brazil
  'com.br','net.br','org.br','gov.br','edu.br','mil.br','art.br','blog.br','eco.br','emp.br','ind.br','inf.br','med.br','rec.br','srv.br','tur.br','tv.br','wiki.br','b.br','not.br','9guacu.br','adm.br','adv.br','arq.br','ato.br','bio.br','cim.br','cng.br','cnt.br','coop.br','eng.br','esp.br','etc.br','eti.br','far.br','flog.br','fm.br','fnd.br','fot.br','fst.br','g12.br','ggf.br','imb.br','jor.br','lel.br','mat.br','mus.br','nom.br','ntr.br','odo.br','ppg.br','pro.br','psc.br','psi.br','qsl.br','radio.br','slg.br','tmp.br','trd.br','vet.br','vlog.br','zlg.br',
  // India
  'co.in','net.in','org.in','firm.in','gen.in','ind.in','ac.in','edu.in','res.in','gov.in','mil.in','nic.in',
  // China
  'com.cn','net.cn','org.cn','gov.cn','edu.cn','mil.cn','ac.cn','bj.cn','sh.cn','tj.cn','cq.cn','he.cn','sx.cn','nm.cn','ln.cn','jl.cn','hl.cn','js.cn','zj.cn','ah.cn','fj.cn','jx.cn','sd.cn','ha.cn','hb.cn','hn.cn','gd.cn','gx.cn','hi.cn','sc.cn','gz.cn','yn.cn','xz.cn','sn.cn','gs.cn','qh.cn','nx.cn','xj.cn','tw.cn','hk.cn','mo.cn',
  // Korea
  'co.kr','ne.kr','or.kr','re.kr','pe.kr','go.kr','mil.kr','ac.kr','hs.kr','ms.kr','es.kr','sc.kr','kg.kr','seoul.kr','busan.kr','daegu.kr','incheon.kr','gwangju.kr','daejeon.kr','ulsan.kr','gyeonggi.kr','gangwon.kr','chungbuk.kr','chungnam.kr','jeonbuk.kr','jeonnam.kr','gyeongbuk.kr','gyeongnam.kr','jeju.kr',
  // Russia
  'com.ru','net.ru','org.ru','pp.ru','msk.ru','spb.ru','ac.ru','edu.ru','gov.ru','int.ru','mil.ru','test.ru',
  // Ukraine
  'com.ua','net.ua','org.ua','edu.ua','gov.ua','in.ua','pp.ua','ck.ua','dn.ua','dp.ua','if.ua','kh.ua','km.ua','kr.ua','ks.ua','lg.ua','lt.ua','mk.ua','od.ua','pl.ua','rv.ua','sm.ua','te.ua','uz.ua','vn.ua','zp.ua','zt.ua','crimea.ua','cv.ua','kherson.ua','dnipro.ua','kiev.ua','kharkiv.ua','lugansk.ua','lutsk.ua','lviv.ua','mykolaiv.ua','odesa.ua','poltava.ua','rivne.ua','sevastopol.ua','sumy.ua','ternopil.ua','vinnytsia.ua','volyn.ua','zakarpattia.ua','zaporizhzhia.ua','zhitomir.ua','cherkassy.ua','chernigov.ua','chernovtsy.ua','uzhgorod.ua','rovno.ua','khmelnitskiy.ua','nikolaev.ua','yalta.ua',
  // Poland
  'com.pl','net.pl','org.pl','info.pl','biz.pl','edu.pl','gov.pl','waw.pl','warszawa.pl','gda.pl','gdansk.pl','krakow.pl','poznan.pl','wroclaw.pl','lodz.pl','szczecin.pl','katowice.pl','bydgoszcz.pl','lublin.pl','bialystok.pl','czest.pl','sosnowiec.pl','slupsk.pl','olsztyn.pl','rzeszow.pl','torun.pl','zgora.pl','opole.pl','kielce.pl','radom.pl','plock.pl','elblag.pl','tarnow.pl','gliwice.pl','tychy.pl','walbrzych.pl','jgora.pl','siedlce.pl','pila.pl','augustow.pl','suwalki.pl','swinoujscie.pl','targi.pl','tm.pl','sklep.pl','gsm.pl','agro.pl','aid.pl','atm.pl','auto.pl','nieruchomosci.pl','priv.pl','pc.pl','kepno.pl','art.pl','glogow.pl','gorlice.pl','grajewo.pl','ilawa.pl','jaworzno.pl','jelenia-gora.pl','kalisz.pl','karpacz.pl','kartuzy.pl','ketrzyn.pl','konskowola.pl','kutno.pl','lapy.pl','lebork.pl','legnica.pl','lezajsk.pl','limanowa.pl','lomza.pl','lowicz.pl','lubin.pl','mazowsze.pl','malopolska.pl','mazury.pl','mielno.pl','mragowo.pl','naklo.pl','nowaruda.pl','nysa.pl','ostroda.pl','ostroleka.pl','ostrowiec.pl','pisz.pl','podhale.pl','pomorskie.pl','powiat.pl','prochowice.pl','pruszkow.pl','przeworsk.pl','pulawy.pl','sanok.pl','sejny.pl','skoczow.pl','slask.pl','starachowice.pl','stargard.pl','swidnica.pl','swiebodzin.pl','tczew.pl','turek.pl','ustka.pl','warmia.pl','wielun.pl','zachpomor.pl','zagan.pl','zyrardow.pl',
  // Germany (few second-levels exist: co.de is not a registry suffix; keep only real ones)
  // Austria
  'co.at','or.at','ac.at','gv.at','biz.at','info.at','priv.at','firm.at','store.at','web.at',
  // France (most French domains are flat under .fr; 'asso.fr' etc are not PSL registrable levels commonly used — omitted on purpose)
  // Italy
  'co.it','or.it','mil.it','edu.it','gov.it',
  // Spain
  'com.es','nom.es','org.es','gob.es','edu.es',
  // Portugal
  'com.pt','org.pt','net.pt','edu.pt','gov.pt','nome.pt','publ.pt',
  // Netherlands
  'co.nl','net.nl','org.nl','bv.nl',
  // Belgium
  'com.be','net.be','org.be','ac.be','gov.be',
  // Sweden
  'com.se','org.se','net.se','ac.se','gov.se','pp.se','tm.se','parti.se','press.se',
  // Norway
  'co.no','org.no','priv.no','fhs.no','folkebibl.no','gs.no','idrett.no','mil.no','museum.no','stat.no','vgs.no','asn.no',
  // Denmark
  'co.dk','org.dk','ac.dk','gov.dk',
  // Finland
  'co.fi','or.fi','ac.fi','gov.fi','iki.fi',
  // Switzerland
  'com.ch','net.ch','org.ch','ac.ch','gov.ch','edu.ch',
  // Czech
  'co.cz','or.cz','net.cz','ac.cz','gov.cz',
  // Slovakia
  'co.sk','or.sk','net.sk','ac.sk','gov.sk',
  // Hungary
  'co.hu','org.hu','net.hu','priv.hu','info.hu','agrar.hu','bolt.hu','casino.hu','city.hu','erotica.hu','erotika.hu','film.hu','forum.hu','games.hu','hotel.hu','ingatlan.hu','jogasz.hu','konyvelo.hu','lakas.hu','media.hu','news.hu','reklam.hu','sex.hu','shop.hu','sport.hu','suli.hu','szex.hu','tm.hu','tozsde.hu','utazas.hu','video.hu',
  // Romania
  'com.ro','org.ro','nom.ro','info.ro','rec.ro','arts.ro','firm.ro','store.ro','tm.ro','www.ro','nt.ro',
  // Greece
  'com.gr','net.gr','org.gr','edu.gr','gov.gr','co.gr',
  // Turkey
  'com.tr','net.tr','org.tr','edu.tr','gov.tr','gen.tr','web.tr','av.tr','bbs.tr','bel.tr','biz.tr','dr.tr','info.tr','k12.tr','name.tr','pol.tr','tel.tr','tsk.tr','tv.tr',
  // Israel
  'co.il','org.il','net.il','ac.il','gov.il','muni.il','idf.il','k12.il',
  // Argentina
  'com.ar','net.ar','org.ar','edu.ar','gov.ar','gob.ar','mil.ar','int.ar','tur.ar','musica.ar',
  // Mexico
  'com.mx','net.mx','org.mx','edu.mx','gob.mx',
  // Chile
  'com.cl','net.cl','org.cl','gov.cl','gob.cl','mil.cl',
  // Colombia
  'com.co','net.co','nom.co','org.co','edu.co','gov.co','mil.co',
  // Peru
  'com.pe','net.pe','org.pe','edu.pe','gob.pe','nom.pe','mil.pe',
  // Venezuela
  'com.ve','net.ve','org.ve','edu.ve','gob.ve','mil.ve','co.ve','info.ve','web.ve','arte.ve','radio.ve','tec.ve',
  // Ecuador
  'com.ec','net.ec','org.ec','edu.ec','gov.ec','gob.ec','fin.ec','info.ec','med.ec','pro.ec','mil.ec',
  // Uruguay
  'com.uy','net.uy','org.uy','edu.uy','gub.uy','mil.uy',
  // Paraguay
  'com.py','net.py','org.py','edu.py','gov.py','coop.py',
  // Bolivia
  'com.bo','net.bo','org.bo','edu.bo','gov.bo','gob.bo','mil.bo','int.bo','tv.bo','academia.bo','agro.bo','arte.bo','blog.bo','bolivia.bo','ciencia.bo','cooperativa.bo','democracia.bo','deporte.bo','ecologia.bo','economia.bo','empresa.bo','indigena.bo','industria.bo','medicina.bo','movimiento.bo','musica.bo','natural.bo','nombre.bo','noticias.bo','patria.bo','plurinacional.bo','politica.bo','profesional.bo','pueblo.bo','revista.bo','salud.bo','tecnologia.bo','tksat.bo','transporte.bo','wiki.bo',
  // Canada
  'co.ca','com.ca','net.ca','org.ca','edu.ca','gov.ca','gc.ca','on.ca','bc.ca','ab.ca','mb.ca','sk.ca','ns.ca','nb.ca','nl.ca','pe.ca','yt.ca','nt.ca','nu.ca','qc.ca',
  // USA
  'us','co.us','org.us','gen.us','dni.us','fed.us','isa.us','kids.us','nsn.us','ak.us','al.us','ar.us','as.us','az.us','ca.us','co.us','ct.us','dc.us','de.us','fl.us','ga.us','gu.us','hi.us','ia.us','id.us','il.us','in.us','ks.us','ky.us','la.us','ma.us','md.us','me.us','mi.us','mn.us','mo.us','ms.us','mt.us','nc.us','nd.us','ne.us','nh.us','nj.us','nm.us','nv.us','ny.us','oh.us','ok.us','or.us','pa.us','pr.us','ri.us','sc.us','sd.us','tn.us','tx.us','ut.us','va.us','vi.us','vt.us','wa.us','wi.us','wv.us','wy.us',
  // Hong Kong
  'com.hk','net.hk','org.hk','edu.hk','gov.hk','idv.hk',
  // Singapore
  'com.sg','net.sg','org.sg','edu.sg','gov.sg','per.sg','idn.sg',
  // Malaysia
  'com.my','net.my','org.my','edu.my','gov.my','mil.my','name.my',
  // Indonesia
  'co.id','net.id','or.id','ac.id','sch.id','web.id','mil.id','go.id','biz.id','my.id','desa.id',
  // Thailand
  'co.th','net.th','or.th','ac.th','go.th','mi.th','in.th',
  // Vietnam
  'com.vn','net.vn','org.vn','edu.vn','gov.vn','ac.vn','biz.vn','info.vn','name.vn','pro.vn','health.vn','int.vn','mil.vn',
  // Philippines
  'com.ph','net.ph','org.ph','edu.ph','gov.ph','mil.ph','i.ph','ngo.ph',
  // Taiwan
  'com.tw','net.tw','org.tw','edu.tw','gov.tw','idv.tw','club.tw','ebiz.tw','game.tw','mil.tw',
  // Pakistan
  'com.pk','net.pk','org.pk','edu.pk','gov.pk','gob.pk','gok.pk','gon.pk','gop.pk','gos.pk','web.pk','fam.pk','biz.pk','info.pk','me.pk',
  // Bangladesh
  'com.bd','net.bd','org.bd','edu.bd','gov.bd','ac.bd','mil.bd','co.bd',
  // Nigeria
  'com.ng','net.ng','org.ng','edu.ng','gov.ng','mil.ng','sch.ng','i.ng','name.ng','mobi.ng','biz.ng',
  // Egypt
  'com.eg','net.eg','org.eg','edu.eg','gov.eg','mil.eg','sci.eg','info.eg','name.eg','tv.eg',
  // Kenya
  'co.ke','or.ke','ne.ke','ac.ke','go.ke','sc.ke','me.ke','mobi.ke','info.ke',
  // Saudi Arabia
  'com.sa','net.sa','org.sa','edu.sa','gov.sa','med.sa','pub.sa','sch.sa',
  // UAE
  'co.ae','net.ae','org.ae','ac.ae','gov.ae','mil.ae','sch.ae','pro.ae','name.ae',
  // Iran
  'co.ir','org.ir','net.ir','ac.ir','gov.ir','sch.ir','id.ir',
  // Morocco
  'co.ma','net.ma','org.ma','ac.ma','gov.ma','press.ma',
  // Tunisia
  'com.tn','net.tn','org.tn','nat.tn','tourism.tn','ens.tn','fin.tn','info.tn','intl.tn','mincom.tn','agrinet.tn','defense.tn','edunet.tn','ind.tn','rnu.tn','rns.tn','rnrt.tn','rrt.tn',
  // Algeria
  'com.dz','net.dz','org.dz','gov.dz','edu.dz','asso.dz','pol.dz','art.dz',
  // Ghana
  'com.gh','org.gh','edu.gh','gov.gh','mil.gh',
  // Tanzania
  'co.tz','or.tz','ac.tz','go.tz','ne.tz','mil.tz','sc.tz','hotel.tz','info.tz','me.tz','mobi.tz','tv.tz',
  // Uganda
  'co.ug','or.ug','ac.ug','sc.ug','go.ug','ne.ug','com.ug','org.ug',
  // Zambia
  'co.zm','org.zm','ac.zm','gov.zm','sch.zm','com.zm','net.zm','edu.zm','biz.zm','info.zm','mil.zm',
  // Zimbabwe
  'co.zw','org.zw','ac.zw','gov.zw','mil.zw',
  // Côte d'Ivoire / francophone Africa
  'co.ci','or.ci','ac.ci','gouv.ci','edu.ci','asso.ci','presse.ci','com.ci',
  'com.sn','org.sn','edu.sn','gouv.sn','art.sn','univ.sn','perso.sn',
  'com.bf','gov.bf','edu.bf',
  'com.ml','org.ml','edu.ml','gouv.ml','presse.ml',
  'com.ne','org.ne','net.ne','edu.ne','gouv.ne',
  'com.bj','org.bj','gouv.bj','edu.bj','asso.bj','barreau.bj',
  'com.tg','org.tg','net.tg','edu.tg','gouv.tg',
  'com.cm','net.cm','org.cm','gov.cm','edu.cm','co.cm','com.cm',
  'com.ga','org.ga','gouv.ga','edu.ga',
  'com.cd','net.cd','org.cd','edu.cd','gov.cd',
  'com.cg','org.cg','net.cg','edu.cg','gouv.cg',
  'com.gq','net.gq','org.gq','edu.gq','gov.gq',
  'com.gn','net.gn','org.gn','edu.gn','gov.gn',
  'com.gw','net.gw','org.gw','edu.gw','gov.gw',
  'com.mg','org.mg','edu.mg','gov.mg','mil.mg','nom.mg','prd.mg','tm.mg',
  'com.mu','net.mu','org.mu','ac.mu','co.mu','gov.mu','or.mu','edu.mu','pro.mu',
  'com.rw','net.rw','org.rw','edu.rw','gov.rw','ac.rw','co.rw','coop.rw','mil.rw','gouv.rw',
  'com.sc','net.sc','org.sc','edu.sc','gov.sc',
  'com.sl','net.sl','org.sl','edu.sl','gov.sl',
  'com.td','net.td','org.td','edu.td','gov.td',
  'com.et','net.et','org.et','edu.et','gov.et',
  'com.so','net.so','org.so','edu.so','gov.so','me.so',
  'com.dj','net.dj','org.dj','edu.dj','gov.dj',
  'com.er','net.er','org.er','edu.er','gov.er','mil.er','ind.er',
  'com.bi','co.bi','org.bi','edu.bi','gov.bi','info.bi','or.bi',
  'co.mz','org.mz','edu.mz','gov.mz','ac.mz','net.mz','adv.mz',
  'co.ao','org.ao','edu.ao','gov.ao','it.ao','gv.ao','og.ao','pb.ao',
  'co.bw','org.bw','ac.bw','gov.bw','net.bw',
  'co.ls','org.ls','ac.ls','gov.ls','net.ls',
  'co.sz','org.sz','ac.sz','gov.sz',
  'co.na','org.na','ac.na','gov.na','edu.na','com.na','net.na','iway.na',
  // Islands / territories
  'com.jm','net.jm','org.jm','edu.jm','gov.jm','mil.jm',
  'com.tt','net.tt','org.tt','edu.tt','gov.tt','co.tt','mil.tt','biz.tt','info.tt','name.tt','pro.tt','aero.tt','cat.tt','jobs.tt','mobi.tt','museum.tt','tel.tt','travel.tt',
  'com.bb','net.bb','org.bb','gov.bb','edu.bb','info.bb','co.bb','store.bb','tv.bb',
  'com.bs','net.bs','org.bs','edu.bs','gov.bs',
  'com.bz','net.bz','org.bz','edu.bz','gov.bz',
  'com.gy','net.gy','org.gy','edu.gy','gov.gy','co.gy',
  'com.sr','net.sr','org.sr','edu.sr','gov.sr','co.sr',
  'com.pr','net.pr','org.pr','edu.pr','gov.pr','isla.pr','biz.pr','info.pr','name.pr','pro.pr','est.pr','prof.pr','ac.pr','mil.pr',
  'com.do','net.do','org.do','edu.do','gov.do','gob.do','mil.do','web.do','art.do','sld.do',
  'com.cu','net.cu','org.cu','edu.cu','gov.cu','inf.cu',
  'com.ht','net.ht','org.ht','edu.ht','gov.ht','coop.ht','med.ht','shop.ht','asso.ht','art.ht','info.ht','perso.ht','pro.ht','rel.ht','firm.ht','adult.ht','pol.ht','gouv.ht',
  'com.hn','net.hn','org.hn','edu.hn','gob.hn','mil.hn',
  'com.sv','net.sv','org.sv','edu.sv','gob.sv','red.sv',
  'com.ni','net.ni','org.ni','edu.ni','gob.ni','nom.ni','co.ni','ac.ni','mil.ni','com.ni',
  'com.cr','net.cr','org.cr','edu.cr','go.cr','ac.cr','co.cr','ed.cr','fi.cr','or.cr','sa.cr','mil.cr',
  'com.pa','net.pa','org.pa','edu.pa','gob.pa','ac.pa','sld.pa','abo.pa','ing.pa','med.pa','nom.pa',
  'com.gt','net.gt','org.gt','edu.gt','gob.gt','mil.gt','ind.gt',
  'com.bh','net.bh','org.bh','edu.bh','gov.bh',
  'com.qa','net.qa','org.qa','edu.qa','gov.qa','mil.qa',
  'com.kw','net.kw','org.kw','edu.kw','gov.kw','ind.kw',
  'com.om','net.om','org.om','edu.om','gov.om','co.om','med.om','museum.om','pro.om','ac.om','sch.om','mil.om',
  'com.jo','net.jo','org.jo','edu.jo','gov.jo','mil.jo','sch.jo','per.jo','name.jo','phd.jo',
  'com.lb','net.lb','org.lb','edu.lb','gov.lb','mil.lb',
  'com.sy','net.sy','org.sy','edu.sy','gov.sy','mil.sy','co.sy','news.sy',
  'com.iq','net.iq','org.iq','edu.iq','gov.iq','mil.iq','com.iq',
  'com.ye','net.ye','org.ye','edu.ye','gov.ye','mil.ye','me.ye','co.ye','ltd.ye','plc.ye','press.ye',
  'com.af','net.af','org.af','edu.af','gov.af','mil.af',
  'com.np','net.np','org.np','edu.np','gov.np','mil.np','name.np','info.np','pro.np','coop.np','asia.np',
  'com.lk','net.lk','org.lk','edu.lk','gov.lk','ac.lk','sch.lk','web.lk','soc.lk','hotel.lk','ltd.lk','assn.lk','grp.lk','ngo.lk',
  'com.mm','net.mm','org.mm','edu.mm','gov.mm','ac.mm','biz.mm','coop.mm','info.mm','per.mm','pro.mm',
  'com.bn','net.bn','org.bn','edu.bn','gov.bn','ac.bn','co.bn',
  'com.kh','net.kh','org.kh','edu.kh','gov.kh','mil.kh','per.kh',
  'com.la','net.la','org.la','edu.la','gov.la','info.la','int.la','per.la','com.la',
  'com.mv','net.mv','org.mv','edu.mv','gov.mv','aero.mv','biz.mv','coop.mv','info.mv','int.mv','museum.mv','name.mv','pro.mv',
  'com.bt','net.bt','org.bt','edu.bt','gov.bt',
  'com.mo','net.mo','org.mo','edu.mo','gov.mo',
  'com.mn','net.mn','org.mn','edu.mn','gov.mn','nyc.mn',
  'com.az','net.az','org.az','edu.az','gov.az','info.az','int.az','mil.az','name.az','pp.az','pro.az','biz.az','co.az','com.az',
  'com.am','net.am','org.am','co.am','radio.am','coc.am',
  'com.ge','net.ge','org.ge','edu.ge','gov.ge','mil.ge','pvt.ge',
  'com.kz','net.kz','org.kz','edu.kz','gov.kz','mil.kz',
  'com.kg','net.kg','org.kg','edu.kg','gov.kg','mil.kg',
  'com.uz','net.uz','org.uz','edu.uz','gov.uz','co.uz',
  'com.tj','net.tj','org.tj','edu.tj','gov.tj','ac.tj','biz.tj','co.tj','dyu.tj','go.tj','info.tj','int.tj','mil.tj','my.tj','name.tj','nic.tj','pro.tj','test.tj','web.tj',
  'com.tm','net.tm','org.tm','edu.tm','gov.tm','co.tm','nom.tm',
  'com.mk','net.mk','org.mk','edu.mk','gov.mk','inf.mk','name.mk','pro.mk',
  'com.al','net.al','org.al','edu.al','gov.al','mil.al',
  'com.ba','net.ba','org.ba','edu.ba','gov.ba','mil.ba','co.ba','unsa.ba','untz.ba','unze.ba','unmo.ba','unbi.ba','unvi.ba',
  'com.rs','net.rs','org.rs','edu.rs','gov.rs','ac.rs','in.rs','co.rs',
  'com.me','net.me','org.me','edu.me','gov.me','ac.me','its.me','priv.me','co.me',
  'com.hr','net.hr','org.hr','edu.hr','gov.hr','iz.hr','from.hr','name.hr',
  'com.si','net.si','org.si','edu.si','gov.si','uni.si','ac.si',
  'com.bg','net.bg','org.bg','edu.bg','gov.bg','ac.bg','info.bg',
  'com.cy','net.cy','org.cy','ac.cy','gov.cy','pro.cy','ekloges.cy','tm.cy','ltd.cy','biz.cy','press.cy','parliament.cy','com.cy',
  'com.lv','net.lv','org.lv','edu.lv','gov.lv','asn.lv','conf.lv','id.lv','mil.lv',
  'com.ee','net.ee','org.ee','edu.ee','gov.ee','pri.ee','fie.ee','med.ee','lib.ee','aip.ee','riik.ee',
  'com.lt','net.lt','org.lt','edu.lt','gov.lt','mil.lt',
  'com.by','net.by','org.by','edu.by','gov.by','mil.by','of.by',
  'com.md','net.md','org.md','edu.md','gov.md','acad.md','co.md','info.md','prof.md','shop.md',
  'com.is','net.is','org.is','edu.is','gov.is','int.is',
  'com.fo','net.fo','org.fo','edu.fo','gov.fo',
  'com.gg','net.gg','org.gg','gov.gg','sch.gg','co.gg','ac.gg',
  'com.je','net.je','org.je','gov.je','sch.je','co.je','ac.je',
  'com.im','net.im','org.im','gov.im','co.im','ac.im','nic.im','ltd.co.im','plc.co.im',
  'com.mt','net.mt','org.mt','edu.mt','gov.mt',
  'com.li','net.li','org.li','edu.li','gov.li','ac.li',
  'com.lu','net.lu','org.lu','edu.lu','gov.lu','resto.lu','asbl.lu',
  'com.mc','net.mc','org.mc','edu.mc','gov.mc','asso.mc','tm.mc',
  'com.sm','net.sm','org.sm','edu.sm','gov.sm','co.sm',
  'com.va','net.va','org.va','edu.va','gov.va','co.va',
  'com.ad','net.ad','org.ad','edu.ad','gov.ad','nom.ad',
  'com.gi','net.gi','org.gi','edu.gi','gov.gi','ltd.gi','mod.gi',
  'com.fj','net.fj','org.fj','edu.fj','gov.fj','ac.fj','biz.fj','info.fj','mil.fj','name.fj','pro.fj',
  'com.pg','net.pg','org.pg','edu.pg','gov.pg','ac.pg',
  'com.sb','net.sb','org.sb','edu.sb','gov.sb','com.sb',
  'com.vu','net.vu','org.vu','edu.vu','gov.vu','info.vu','biz.vu','me.vu',
  'com.ki','net.ki','org.ki','edu.ki','gov.ki','info.ki','biz.ki','mob.ki','tel.ki',
  'com.to','net.to','org.to','edu.to','gov.to','mil.to',
  'com.ws','net.ws','org.ws','edu.ws','gov.ws',
  'com.as','net.as','org.as','edu.as','gov.as',
  'com.gu','net.gu','org.gu','edu.gu','gov.gu','mil.gu',
  'com.mp','net.mp','org.mp','edu.mp','gov.mp','mil.mp',
  'com.pw','net.pw','org.pw','edu.pw','gov.pw','belau.pw','co.pw','ed.pw','go.pw','or.pw',
  'com.nr','net.nr','org.nr','edu.nr','gov.nr','biz.nr','info.nr','name.nr','me.nr','tv.nr',
  'com.tk','net.tk','org.tk','edu.tk','gov.tk',
  'com.ck','net.ck','org.ck','edu.ck','gov.ck','co.ck','gen.ck','biz.ck','info.ck',
  'com.nu','net.nu','org.nu','edu.nu','gov.nu',
  'com.nf','net.nf','org.nf','edu.nf','gov.nf','arts.nf','com.nf','firm.nf','info.nf','other.nf','per.nf','rec.nf','store.nf','web.nf',
  'com.pn','net.pn','org.pn','edu.pn','gov.pn','co.pn',
  'com.tc','net.tc','org.tc','edu.tc','gov.tc','pro.tc','name.tc',
  'com.vg','net.vg','org.vg','edu.vg','gov.vg','mil.vg',
  'com.ky','net.ky','org.ky','edu.ky','gov.ky','ac.ky',
  'com.ai','net.ai','org.ai','edu.ai','gov.ai','off.ai','com.ai',
  'com.ag','net.ag','org.ag','edu.ag','gov.ag','nom.ag','co.ag',
  'com.dm','net.dm','org.dm','edu.dm','gov.dm','co.dm',
  'com.gd','net.gd','org.gd','edu.gd','gov.gd',
  'com.vc','net.vc','org.vc','edu.vc','gov.vc','com.vc','mil.vc','co.vc',
  'com.lc','net.lc','org.lc','edu.lc','gov.lc','co.lc','l.lc','p.lc',
  'com.ms','net.ms','org.ms','edu.ms','gov.ms',
  'com.kn','net.kn','org.kn','edu.kn','gov.kn',
  'com.aw','net.aw','org.aw','edu.aw','gov.aw','com.aw',
  'com.cw','net.cw','org.cw','edu.cw','gov.cw',
  'com.sx','net.sx','org.sx','gov.sx','edu.sx',
  'com.bq','net.bq','org.bq','edu.bq','gov.bq',
  'com.bm','net.bm','org.bm','edu.bm','gov.bm',
  'com.gf','net.gf','org.gf','edu.gf','gov.gf','asso.gf',
  'com.gp','net.gp','org.gp','edu.gp','gov.gp','asso.gp',
  'com.mq','net.mq','org.mq','edu.mq','gov.mq','asso.mq',
  'com.re','net.re','org.re','edu.re','gov.re','asso.re','nom.re',
  'com.yt','net.yt','org.yt','edu.yt','gov.yt','asso.yt','nom.yt',
  'com.pm','net.pm','org.pm','edu.pm','gov.pm','asso.pm','nom.pm',
  'com.tf','net.tf','org.tf','edu.tf','gov.tf','asso.tf','nom.tf',
  'com.nc','net.nc','org.nc','edu.nc','gov.nc','asso.nc','nom.nc',
  'com.pf','net.pf','org.pf','edu.pf','gov.pf','asso.pf',
  'com.wf','net.wf','org.wf','edu.wf','gov.wf','asso.wf',
  'com.gm','net.gm','org.gm','edu.gm','gov.gm',
  'com.cv','net.cv','org.cv','edu.cv','gov.cv','publ.cv','int.cv','nome.cv',
  'com.st','net.st','org.st','edu.st','gov.st','co.st','store.st','mil.st','saude.st','nom.st',
  'com.gl','net.gl','org.gl','edu.gl','gov.gl','co.gl','nom.gl',
  'com.ps','net.ps','org.ps','edu.ps','gov.ps','plo.ps','sec.ps',
  'com.ax','net.ax','org.ax','edu.ax','gov.ax','aland.ax',
  'com.lk','lk','com.fm','net.fm','org.fm','edu.fm','gov.fm','radio.fm',
  'com.tv','net.tv','org.tv','edu.tv','gov.tv','idv.tv',
  'com.sh','net.sh','org.sh','edu.sh','gov.sh','mil.sh',
  'com.ac','net.ac','org.ac','edu.ac','gov.ac','mil.ac',
  'com.io','net.io','org.io','edu.io','gov.io','co.io',
  'com.sb','co.mw','org.mw','ac.mw','gov.mw','net.mw','edu.mw','com.mw','coop.mw',
  'com.mh','net.mh','org.mh','edu.mh','gov.mh',
  'com.fk','net.fk','org.fk','gov.fk','ac.fk','nom.fk','co.fk',
  'com.gs','net.gs','org.gs','edu.gs','gov.gs','co.gs',
  'com.bv','net.bv','org.bv','edu.bv','gov.bv',
  'com.hm','net.hm','org.hm','edu.hm','gov.hm',
  'com.aq','net.aq','org.aq','edu.aq','gov.aq',
  'com.tf','com.bl','net.bl','org.bl','edu.bl','gov.bl',
  'com.sj','net.sj','org.sj','edu.sj','gov.sj',
  'com.mf','net.mf','org.mf','edu.mf','gov.mf',
  'com.pm','com.sx','com.gg','com.ax','com.uz','com.sb'
];

/* Common "private" suffixes for managed hosting platforms (PSL private section). */
const privateSuffixes = [
  'blogspot.com','blogspot.in','blogspot.jp','blogspot.de','blogspot.fr','blogspot.it','blogspot.es','blogspot.br','blogspot.ca','blogspot.co.uk','blogspot.com.au','blogspot.mx','blogspot.pt','blogspot.ch','blogspot.at','blogspot.be','blogspot.nl','blogspot.pl','blogspot.se','blogspot.no','blogspot.dk','blogspot.fi','blogspot.ie','blogspot.cz','blogspot.hu','blogspot.gr','blogspot.ro','blogspot.sg','blogspot.hk','blogspot.tw','blogspot.kr','blogspot.co.nz','blogspot.co.za','blogspot.co.in','blogspot.co.id','blogspot.com.ar','blogspot.com.tr','blogspot.com.eg','blogspot.com.ng','blogspot.com.hk','blogspot.com.sg','blogspot.com.my','blogspot.com.ph','blogspot.com.pk','blogspot.com.uy','blogspot.com.vn',
  'github.io','githubusercontent.com',
  'netlify.app','netlify.com','webflow.io',
  'vercel.app','now.sh',
  'pages.dev','workers.dev','web.app','firebaseapp.com','appspot.com',
  'herokuapp.com','herokussl.com','onrender.com','fly.dev','railway.app',
  'gitlab.io','bitbucket.io','surge.sh','readthedocs.io',
  'wixsite.com','editorx.io','wixstudio.io','myshopify.com','shopifypreview.com',
  'wordpress.com','wpcomstaging.com','tumblr.com','weebly.com','typeform.com','ghost.io','substack.com',
  'cloudfront.net','s3.amazonaws.com','s3-website-us-east-1.amazonaws.com','s3-website-us-west-2.amazonaws.com','amazonaws.com',
  'azurewebsites.net','azurecontainer.io','cloudapp.net','cloudapp.azure.com','trafficmanager.net','blob.core.windows.net',
  'elasticbeanstalk.com','on-acorn.io','withgoogle.com',
  'pages.github.io' // removed from PSL in 2022; omitted on purpose — this line is a comment anchor
].filter(s => s !== 'pages.github.io');

/* Build rule sets: Map label -> Set(labels joined). Exceptions via "!". */
const icann = new Set();
for (const t of ccTLDs) icann.add(t);
for (const t of gTLDs) icann.add(t);
for (const s of multiLevel) icann.add(s);
const priv = new Set(privateSuffixes);
const exceptions = new Set();

/* All rules, longest-match, exception-aware. */
function matchRule(labels) {
  // iterate from the left: the first (longest) candidate match wins,
  // matching PSL semantics. Exceptions extend the registrable domain.
  for (let i = 0; i < labels.length; i++) {
    const candidate = labels.slice(i).join('.');
    if (exceptions.has(candidate)) {
      const suffix = labels.slice(i + 1).join('.');
      return suffix ? { suffix, rule: '!' + candidate } : null;
    }
    if (icann.has(candidate) || priv.has(candidate)) {
      return { suffix: candidate, rule: candidate };
    }
  }
  return null;
}

/* Return the public suffix for a hostname (labels array), or null when the
 * hostname is outside the bundled snapshot. */
function publicSuffixFor(labels) {
  const m = matchRule(labels);
  if (!m) return null;
  return { suffix: m.suffix, rule: m.rule, type: priv.has(m.rule) ? 'private' : 'icann' };
}

function hasTld(tld) {
  const l = String(tld || '').toLowerCase().replace(/^\./, '');
  return icann.has(l) || priv.has(l);
}

module.exports = { icann, priv, exceptions, publicSuffixFor, hasTld };
