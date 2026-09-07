import React from "react";
import ReactApexChart from "react-apexcharts";
import Card from "./Card";
import Typography from "./Typography";

const buildOptions = (chartType, chartColor, extraOptions = {}) => {
  const isBar = chartType === "bar";
  const isArea = chartType === "area";
  const isDonut = chartType === "donut" || chartType === "pie";

  return {
    chart: {
      type: chartType,
      sparkline: { enabled: true },
      animations: { enabled: true, speed: 400 },
      toolbar: { show: false },
      background: "transparent",
    },
    stroke: {
      curve: "smooth",
      width: isBar ? 0 : isDonut ? 0 : 2,
      colors: ["rgba(255,255,255,0.9)"],
    },
    fill: {
      type: isArea ? "gradient" : "solid",
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.35,
        opacityTo: 0.02,
        stops: [0, 100],
        colorStops: [
          { offset: 0, color: "rgba(255,255,255,0.5)", opacity: 0.5 },
          { offset: 100, color: "rgba(255,255,255,0)", opacity: 0 },
        ],
      },
    },
    plotOptions: {
      bar: {
        columnWidth: "55%",
        borderRadius: 3,
        distributed: true,
      },
      pie: {
        donut: { size: "72%" },
      },
    },
    colors: isDonut
      ? ["rgba(255,255,255,0.9)", "rgba(255,255,255,0.15)"]
      : ["rgba(255,255,255,0.9)"],
    markers: chartType === "line"
      ? { size: 4, colors: ["#fff"], strokeColors: "#fff", strokeWidth: 2 }
      : { size: 0 },
    ...extraOptions,
    tooltip: {
      theme: "dark",
      x: { show: false },
      y: { formatter: (val) => val },
    },
    legend: { show: false },
    dataLabels: { enabled: false },
    grid: { show: false },
    xaxis: {
      labels: { show: false },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: { show: false },
  };
};

const StateCard = ({
  icon: Icon,
  label,
  value,
  chart,
  chartColor,
  chartType = "area",
  chartOptions = {},
  donutSeries,
  donutLabels,
}) => {
  const isDoughnut = chartType === "donut" || chartType === "pie";

  const series = isDoughnut
    ? donutSeries ?? [75, 25]
    : chartType === "bar"
    ? [{ name: label, data: (chart ?? []).map((val, i, arr) => ({
        x: i,
        y: val,
        fillColor: `rgba(255,255,255,${0.15 + (i / (arr.length - 1)) * 0.85})`,
      })) }]
    : [{ name: label, data: chart ?? [] }];

  const options = {
    ...buildOptions(chartType, chartColor, chartOptions),
    ...(isDoughnut && {
      labels: donutLabels ?? [],
    }),
  };

  const hasChart = isDoughnut ? true : chart && chart.length > 0;

  return (
    <Card variant="simple" className="flex items-center justify-between gap-4 p-5">
      {/* Left */}
      <div className="flex flex-col gap-2 min-w-0">
        <div className="flex items-center gap-2 text-white/50 text-sm">
          {Icon && (
            <span className="flex items-center justify-center w-7 h-7 rounded-full bg-white/10">
              <Icon size={14} />
            </span>
          )}
          <span className="truncate">{label}</span>
        </div>
        <Typography variant="h4" className="font-bold whitespace-nowrap">
          {value}
        </Typography>
      </div>

      {/* Right — chart */}
      {hasChart && (
        <div className="shrink-0 w-28 h-16">
          <ReactApexChart
            options={options}
            series={series}
            type={isDoughnut ? "donut" : chartType}
            height="100%"
            width="100%"
          />
        </div>
      )}
    </Card>
  );
};

export default StateCard;
