/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        // Veyra is the product; the root should land on it. Temporary (307)
        // rather than permanent, because a 308 is cached by browsers
        // indefinitely and would be painful to walk back.
        source: '/',
        destination: '/veyra',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
