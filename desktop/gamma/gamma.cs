using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Windows.Forms;

static class Gamma
{
    [StructLayout(LayoutKind.Sequential)]
    struct Ramp
    {
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 256)] public ushort[] Red;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 256)] public ushort[] Green;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 256)] public ushort[] Blue;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ColorEffect { [MarshalAs(UnmanagedType.ByValArray, SizeConst = 25)] public float[] M; }

    [DllImport("gdi32.dll")] static extern bool SetDeviceGammaRamp(IntPtr hdc, ref Ramp ramp);
    [DllImport("gdi32.dll", CharSet = CharSet.Auto)] static extern IntPtr CreateDC(string driver, string device, string output, IntPtr init);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hdc);
    [DllImport("Magnification.dll")] static extern bool MagInitialize();
    [DllImport("Magnification.dll")] static extern bool MagUninitialize();
    [DllImport("Magnification.dll")] static extern bool MagSetFullscreenColorEffect(ref ColorEffect effect);

    [DllImport("nvapi64.dll", EntryPoint = "nvapi_QueryInterface", CallingConvention = CallingConvention.Cdecl)] static extern IntPtr NvQuery(uint id);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int NvInit();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int NvEnum(int i, out IntPtr h);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int NvDvc(IntPtr h, uint output, ref DvcInfo info);
    [StructLayout(LayoutKind.Sequential)] struct DvcInfo { public uint Ver; public int Cur, Min, Max, Def; }

    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    static readonly double[] Luma = { 0.2126, 0.7152, 0.0722 };
    static bool magReady, filterOn, rampTouched;
    static double nightG = 1, nightL = 0;
    static double vib = -1, sat = 100, bri = 50, con = 50, gam = 1, temp = 0;

    static List<IntPtr> nvDisplays;
    static NvDvc nvGet, nvSet;
    static readonly Dictionary<IntPtr, int> nvOriginal = new Dictionary<IntPtr, int>();
    static int vibBase = -1;

    static bool NvReady()
    {
        if (nvDisplays != null) return nvDisplays.Count > 0;
        nvDisplays = new List<IntPtr>();
        try
        {
            var init = (NvInit)Marshal.GetDelegateForFunctionPointer(NvQuery(0x0150E828), typeof(NvInit));
            if (init() != 0) return false;
            var en = (NvEnum)Marshal.GetDelegateForFunctionPointer(NvQuery(0x9ABDD40D), typeof(NvEnum));
            nvGet = (NvDvc)Marshal.GetDelegateForFunctionPointer(NvQuery(0x0E45002D), typeof(NvDvc));
            nvSet = (NvDvc)Marshal.GetDelegateForFunctionPointer(NvQuery(0x4A82C2B1), typeof(NvDvc));
            IntPtr h;
            for (int i = 0; en(i, out h) == 0; i++) nvDisplays.Add(h);
        }
        catch { nvDisplays.Clear(); }
        return nvDisplays.Count > 0;
    }

    static DvcInfo NvRead(IntPtr h) { var d = new DvcInfo { Ver = 20 | 0x10000 }; nvGet(h, 0, ref d); return d; }

    static int NvCurrent() { return NvReady() ? NvRead(nvDisplays[0]).Cur : -1; }

    static bool NvSetVibrance(int level)
    {
        if (!NvReady()) return false;
        bool ok = true;
        foreach (var h in nvDisplays)
        {
            var d = NvRead(h);
            if (!nvOriginal.ContainsKey(h)) { if (level < 0) continue; nvOriginal[h] = d.Cur; }
            int target = level >= 0 ? level : vibBase >= 0 ? vibBase : nvOriginal[h];
            d.Cur = Math.Max(d.Min, Math.Min(d.Max, target));
            ok &= nvSet(h, 0, ref d) == 0;
        }
        if (level < 0) nvOriginal.Clear();
        return ok;
    }

    static double[] TempGain()
    {
        double t = temp / 100.0;
        return t >= 0 ? new[] { 1.0, 1 - 0.10 * t, 1 - 0.25 * t } : new[] { 1 + 0.25 * t, 1 + 0.10 * t, 1.0 };
    }
    static double Curve(double x, int c, double strength)
    {
        double g = gam * nightG;
        double y = nightL + (1 - nightL) * Math.Pow(x, 1.0 / g);
        y = (y - 0.5) * (1 + (con - 50) / 100.0) + 0.5 + (bri - 50) / 100.0;
        y *= TempGain()[c];
        y = x + (y - x) * strength;
        return Math.Max(0, Math.Min(1, y));
    }
    static bool RampIsIdentity() { return nightG == 1 && nightL == 0 && gam == 1 && bri == 50 && con == 50 && temp == 0; }

    static Ramp BuildRamp(double strength)
    {
        var r = new Ramp { Red = new ushort[256], Green = new ushort[256], Blue = new ushort[256] };
        for (int i = 0; i < 256; i++)
        {
            double x = i / 255.0;
            r.Red[i] = (ushort)Math.Round(Curve(x, 0, strength) * 65535);
            r.Green[i] = (ushort)Math.Round(Curve(x, 1, strength) * 65535);
            r.Blue[i] = (ushort)Math.Round(Curve(x, 2, strength) * 65535);
        }
        return r;
    }

    static double TryRamp()
    {
        bool reset = RampIsIdentity();
        double worst = 1.0;
        int done = 0, total = 0;
        foreach (var screen in Screen.AllScreens)
        {
            total++;
            IntPtr dc = CreateDC(null, screen.DeviceName, null, IntPtr.Zero);
            if (dc == IntPtr.Zero) continue;
            double applied = -1;
            for (double s = 1.0; s > 0.05; s -= 0.05)
            {
                var ramp = BuildRamp(reset ? 1 : s);
                if (SetDeviceGammaRamp(dc, ref ramp)) { applied = s; break; }
                if (reset) break;
            }
            DeleteDC(dc);
            if (applied >= 0) { done++; worst = Math.Min(worst, applied); }
        }
        return total > 0 && done == total ? worst : -1;
    }

    static bool SetFilter(double satMul, bool withCurve)
    {
        bool identity = satMul == 1 && (!withCurve || RampIsIdentity());
        if (identity && !filterOn) return true;
        if (!magReady) magReady = MagInitialize();
        if (!magReady) return false;
        double g = gam * nightG, k = 1 + (con - 50) / 100.0;
        double gainG = 1 + (g - 1) * 0.5, offG = nightL + (g - 1) * 0.015;
        var tg = TempGain();
        var e = new ColorEffect { M = new float[25] };
        for (int j = 0; j < 3; j++)
        {
            double gain = withCurve ? gainG * k * tg[j] : 1;
            double off = withCurve ? ((offG - 0.5) * k + 0.5 + (bri - 50) / 100.0) * tg[j] : 0;
            for (int i = 0; i < 3; i++) e.M[i * 5 + j] = (float)(((1 - satMul) * Luma[i] + (i == j ? satMul : 0)) * gain);
            e.M[20 + j] = (float)off;
        }
        e.M[18] = e.M[24] = 1;
        bool ok = MagSetFullscreenColorEffect(ref e);
        filterOn = ok && !identity;
        return ok;
    }

    static string Apply()
    {
        string vibMethod = "off";
        double satMul = sat / 100.0;
        if (vib >= 0)
        {
            if (NvSetVibrance((int)Math.Round(vib))) vibMethod = "nvidia";
            else { satMul *= 1 + (vib - 50) / 100.0; vibMethod = "filter"; }
        }
        else NvSetVibrance(-1);

        string method = "off";
        double strength = 0;
        bool curveInFilter = false;
        if (!RampIsIdentity() || rampTouched)
        {
            rampTouched = !RampIsIdentity();
            strength = TryRamp();
            if (strength >= 0) method = RampIsIdentity() ? "off" : "gamma";
            else { curveInFilter = true; strength = 1; method = RampIsIdentity() ? "off" : "filter"; }
        }
        bool filterOk = SetFilter(satMul, curveInFilter);
        if (!filterOk && (curveInFilter && !RampIsIdentity() || satMul != 1)) return "{\"ok\":false,\"method\":\"none\",\"strength\":0}";
        return "{\"ok\":true,\"method\":\"" + method + "\",\"strength\":" + strength.ToString("0.00", Inv)
            + ",\"vibrance\":\"" + vibMethod + "\",\"driverVibrance\":" + NvCurrent() + "}";
    }

    static double Num(string s, double fallback, double min, double max)
    {
        double v;
        return double.TryParse(s, NumberStyles.Float, Inv, out v) ? Math.Max(min, Math.Min(max, v)) : fallback;
    }

    [STAThread]
    static int Main(string[] args)
    {
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            var p = line.Trim().Split(' ');
            if (p[0] == "quit") break;
            if (p[0] == "color" && p.Length >= 7)
            {
                vib = Num(p[1], -1, -1, 100); sat = Num(p[2], 100, 0, 200); bri = Num(p[3], 50, 0, 100);
                con = Num(p[4], 50, 0, 100); gam = Num(p[5], 1, 0.3, 2.8); temp = Num(p[6], 0, -100, 100);
                if (p.Length > 7) vibBase = (int)Num(p[7], -1, -1, 100);
            }
            else
            {
                double g;
                if (!double.TryParse(p[0], NumberStyles.Float, Inv, out g)) { Console.WriteLine("{\"ok\":false,\"error\":\"bad input\"}"); continue; }
                nightG = Math.Max(0.5, Math.Min(4.0, g));
                nightL = p.Length > 1 ? Num(p[1], 0, 0, 0.3) : 0;
            }
            Console.WriteLine(Apply());
            Console.Out.Flush();
        }
        nightG = 1; nightL = 0; vib = -1; sat = 100; bri = 50; con = 50; gam = 1; temp = 0;
        Apply();
        if (magReady) MagUninitialize();
        return 0;
    }
}
