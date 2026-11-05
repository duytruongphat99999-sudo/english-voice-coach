import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests',fullyParallel:true,workers:2,timeout:45000,
  use:{baseURL:process.env.TEST_URL||'http://127.0.0.1:4424',viewport:{width:390,height:844},trace:'retain-on-failure',
    launchOptions:{channel:process.env.CI?undefined:'chrome',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}},
  projects:[
    {name:'chromium',use:{browserName:'chromium'}},
    {name:'webkit',use:{browserName:'webkit',isMobile:true,hasTouch:true,launchOptions:{channel:undefined,args:[]}}},
  ],
  webServer:process.env.TEST_URL?undefined:{command:'npm run preview -- --host 127.0.0.1 --port 4424',url:'http://127.0.0.1:4424',reuseExistingServer:!process.env.CI},
});
