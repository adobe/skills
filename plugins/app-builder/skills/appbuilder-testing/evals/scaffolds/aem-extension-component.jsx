import { register } from '@adobe/uix-guest';

function ExtensionRegistration() {
  const init = async () => {
    const guestConnection = await register({
      id: 'com.example.aem.cf-console-export',
      methods: {
        actionBar: {
          getButtons() {
            return [
              {
                id: 'export-fragments',
                label: 'Export Fragments',
                icon: 'Export',
              },
            ];
          },
        },
      },
    });
  };
  init().catch(console.error);
  return <div>Loading extension...</div>;
}

export default ExtensionRegistration;
